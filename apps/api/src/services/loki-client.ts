/**
 * Shared Loki query/parse helpers. Originally lived entirely inside
 * `routes/admin-logs.ts`; the log-line parser and a bounded-timeout range
 * query are factored out here so `routes/diagnostics/correlation.ts` and
 * `routes/diagnostics/system-snapshot.ts` (#775) can reuse the exact same
 * parsing and reachability logic instead of forking it. `admin-logs.ts`
 * keeps its own querystring/LogQL-selector building — that part is specific
 * to its own request shape — but imports `LogEntry`/`parseLine` from here.
 */

interface LokiStream {
  stream: Record<string, string>
  values: [string, string][]
}

interface LokiQueryData {
  resultType: string
  result: LokiStream[]
}

interface LokiQueryResponse {
  status: string
  data: LokiQueryData
}

/** Normalised log entry returned to callers. */
export interface LogEntry {
  ts: string
  level: string | null
  service: string | null
  message: string | null
  requestId: string | null
  queue: string | null
  jobId: string | null
  sourceId: string | null
  stack: string | null
  /** Any remaining structured fields not captured above */
  extra: Record<string, unknown>
}

/**
 * Parse a Loki log line into a structured LogEntry.
 * Lines are pino-formatted JSON; fall back to raw message string if parsing fails.
 */
export function parseLine(streamLabels: Record<string, string>, line: string, tsNs: string): LogEntry {
  const ts = new Date(Math.floor(Number(tsNs) / 1_000_000)).toISOString()

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(line) as Record<string, unknown>
  } catch {
    return {
      ts,
      level: streamLabels.level ?? null,
      service: streamLabels.service ?? null,
      message: line,
      requestId: null,
      queue: null,
      jobId: null,
      sourceId: null,
      stack: null,
      extra: {},
    }
  }

  const pull = (key: string): string | null => {
    const v = parsed[key]
    if (typeof v === 'string') {
      delete parsed[key]
      return v || null
    }
    return null
  }

  // pino level numbers → names (pino defaults: trace=10 debug=20 info=30 warn=40 error=50 fatal=60)
  const levelNum = parsed.level
  delete parsed.level
  let levelName: string | null = streamLabels.level ?? null
  if (typeof levelNum === 'number') {
    if (levelNum < 20) levelName = 'trace'
    else if (levelNum < 30) levelName = 'debug'
    else if (levelNum < 40) levelName = 'info'
    else if (levelNum < 50) levelName = 'warn'
    else if (levelNum < 60) levelName = 'error'
    else levelName = 'fatal'
  } else if (typeof levelNum === 'string') {
    levelName = levelNum
  }

  // Remove well-known noise fields
  delete parsed.time
  delete parsed.pid
  delete parsed.hostname
  delete parsed.v

  const service = pull('service') ?? streamLabels.service ?? streamLabels.app ?? null
  const message = pull('msg') ?? pull('message') ?? null
  const requestId = pull('requestId') ?? pull('req_id') ?? null
  const queue = pull('queue') ?? null
  const jobId = pull('jobId') ?? pull('job_id') ?? null
  const sourceId = pull('sourceId') ?? pull('source_id') ?? null
  const stack = pull('stack') ?? null

  return {
    ts,
    level: levelName,
    service,
    message,
    requestId,
    queue,
    jobId,
    sourceId,
    stack,
    extra: parsed as Record<string, unknown>,
  }
}

export interface LokiRangeQuery {
  logql: string
  startMs: number
  endMs: number
  limit: number
  timeoutMs?: number
}

export type LokiRangeResult =
  | { ok: true; entries: LogEntry[] }
  | { ok: false; unavailable: true; message: string }
  | { ok: false; unavailable: false; statusCode: number; message: string }

/**
 * Query Loki's `query_range` endpoint and return normalised, newest-first
 * entries — the same bounded-timeout pattern `admin-logs.ts` uses (8s
 * default), shared so correlation/system-snapshot don't re-derive it.
 */
export async function queryLokiRange(lokiUrl: string, query: LokiRangeQuery): Promise<LokiRangeResult> {
  const params = new URLSearchParams({
    query: query.logql,
    limit: String(query.limit),
    start: String(query.startMs * 1_000_000),
    end: String(query.endMs * 1_000_000),
    direction: 'backward',
  })

  let res: Response
  try {
    res = await fetch(`${lokiUrl}/loki/api/v1/query_range?${params.toString()}`, {
      signal: AbortSignal.timeout(query.timeoutMs ?? 8_000),
    })
  } catch (err) {
    return { ok: false, unavailable: true, message: err instanceof Error ? err.message : 'Loki unavailable' }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, unavailable: false, statusCode: res.status, message: `Loki responded ${res.status}: ${text}` }
  }

  const body = (await res.json()) as LokiQueryResponse
  const entries: LogEntry[] = []
  for (const stream of body.data?.result ?? []) {
    for (const [tsNs, line] of stream.values) {
      entries.push(parseLine(stream.stream, line, tsNs))
    }
  }
  entries.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))

  return { ok: true, entries }
}

/**
 * Cheap reachability probe against Loki's readiness endpoint — used by
 * `get_system_snapshot` (#775) to populate `signalAvailability.loki` with a
 * real reachability result instead of the hardcoded `'available'` every
 * other `computeAttentionSnapshot` caller implicitly reports.
 */
export async function pingLoki(lokiUrl: string, timeoutMs = 3_000): Promise<boolean> {
  try {
    const res = await fetch(`${lokiUrl}/ready`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}
