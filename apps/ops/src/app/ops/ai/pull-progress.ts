/**
 * Pure helpers for parsing and accumulating Ollama's `/api/pull` NDJSON
 * progress stream (#250). Kept free of React/DOM so it can be unit tested
 * without a component-rendering environment, and reused by the client-side
 * stream reader in `ModelPullButton.tsx`.
 */

/** One line of the newline-delimited JSON body Ollama streams from `/api/pull`. */
export interface PullProgressLine {
  status: string
  digest?: string
  total?: number
  completed?: number
  error?: string
}

/** Per-layer download progress, keyed by digest. */
export interface PullLayerProgress {
  total: number
  completed: number
}

export interface PullState {
  /** Most recent status line from Ollama (e.g. "pulling manifest", "success"). */
  status: string
  layers: Record<string, PullLayerProgress>
  /** 0-100, or null when no layer has reported a total yet. */
  overallPercent: number | null
  done: boolean
  error: string | null
}

export function initialPullState(): PullState {
  return { status: '', layers: {}, overallPercent: null, done: false, error: null }
}

/** Parses one NDJSON line. Returns null for blank lines or malformed JSON. */
export function parsePullLine(raw: string): PullProgressLine | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const obj = parsed as Record<string, unknown>
    if (typeof obj.error === 'string') {
      return { status: typeof obj.status === 'string' ? obj.status : '', error: obj.error }
    }
    if (typeof obj.status !== 'string') return null
    const line: PullProgressLine = { status: obj.status }
    if (typeof obj.digest === 'string') line.digest = obj.digest
    if (typeof obj.total === 'number') line.total = obj.total
    if (typeof obj.completed === 'number') line.completed = obj.completed
    return line
  } catch {
    return null
  }
}

/** Folds one parsed progress line into the running pull state. Pure — returns a new state. */
export function applyPullLine(state: PullState, line: PullProgressLine): PullState {
  if (line.error) {
    return { ...state, status: line.status || state.status, error: line.error, done: true }
  }

  const layers = line.digest
    ? {
        ...state.layers,
        [line.digest]: {
          total: line.total ?? state.layers[line.digest]?.total ?? 0,
          completed: line.completed ?? state.layers[line.digest]?.completed ?? 0,
        },
      }
    : state.layers

  // Ollama pulls layers sequentially and never reports the total layer count
  // up front, so this sum only ever covers layers seen so far. When a new
  // layer's first line adds its `total` to the denominator before any of its
  // bytes have been `completed`, the percent can briefly dip before climbing
  // again — that's an artifact of the protocol, not a bug in this reducer.
  const layerValues = Object.values(layers)
  const totalBytes = layerValues.reduce((s, l) => s + l.total, 0)
  const completedBytes = layerValues.reduce((s, l) => s + l.completed, 0)
  const overallPercent = totalBytes > 0 ? Math.min(100, Math.round((completedBytes / totalBytes) * 100)) : state.overallPercent

  const done = line.status === 'success'

  return {
    status: line.status,
    layers,
    overallPercent: done ? 100 : overallPercent,
    done,
    error: null,
  }
}

/**
 * Splits a decoded text chunk into complete NDJSON lines, carrying any
 * trailing partial line forward in `buffer` for the next chunk.
 */
export function splitNdjsonChunk(buffer: string, chunk: string): { lines: string[]; buffer: string } {
  const combined = buffer + chunk
  const parts = combined.split('\n')
  const buffered = parts.pop() ?? ''
  return { lines: parts, buffer: buffered }
}
