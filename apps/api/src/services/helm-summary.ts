import type { HelmCountReading, HelmSummary } from '@wivwav/types'

/** Per-reading budget; stays well under the ops browser's 10s request timeout. */
export const HELM_READING_TIMEOUT_MS = 4000

/** Aborted on timeout; only dependencies that support cancellation honour it. */
type Reading = (signal: AbortSignal) => Promise<number>

export interface HelmSummaryDeps {
  /** All listing rows, any status. */
  countStored: Reading
  /** Active listing rows (observed active). */
  countActive: Reading
  /** Active listing rows with publicationStatus `eligible`. */
  countEligible: Reading
  /** Documents in the live search listing index. */
  countIndexed: Reading
  now?: () => Date
  /** Per-reading deadline in ms; defaults to {@link HELM_READING_TIMEOUT_MS}. */
  readingTimeoutMs?: number
}

const UNAVAILABLE: HelmCountReading = { value: null, availability: 'unavailable', collectedAt: null }

async function read(fn: Reading, now: () => Date, timeoutMs: number): Promise<HelmCountReading> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<HelmCountReading>(resolve => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(UNAVAILABLE)
    }, timeoutMs)
  })
  const reading = (async (): Promise<HelmCountReading> => {
    try {
      const value = await fn(controller.signal)
      return { value, availability: 'available', collectedAt: now().toISOString() }
    } catch {
      // Also swallows a rejection that arrives after the deadline already won.
      return UNAVAILABLE
    }
  })()
  try {
    return await Promise.race([reading, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Runs the four inventory readings independently; one failing never zeroes
 * or hides the others. Not an atomic snapshot.
 */
export async function collectHelmSummary(deps: HelmSummaryDeps): Promise<HelmSummary> {
  const now = deps.now ?? (() => new Date())
  const timeoutMs = deps.readingTimeoutMs ?? HELM_READING_TIMEOUT_MS
  const [stored, active, eligible, indexed] = await Promise.all([
    read(deps.countStored, now, timeoutMs),
    read(deps.countActive, now, timeoutMs),
    read(deps.countEligible, now, timeoutMs),
    read(deps.countIndexed, now, timeoutMs),
  ])
  const databaseDown = [stored, active, eligible].some(r => r.availability === 'unavailable')
  return {
    collectedAt: now().toISOString(),
    counts: { stored, active, eligible, indexed },
    availability: {
      database: databaseDown ? 'unavailable' : 'available',
      search: indexed.availability,
    },
  }
}
