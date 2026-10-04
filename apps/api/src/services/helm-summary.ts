import type { HelmCountReading, HelmSummary } from '@wivwav/types'

export interface HelmSummaryDeps {
  /** All listing rows, any status. */
  countStored: () => Promise<number>
  /** Active listing rows (observed active). */
  countActive: () => Promise<number>
  /** Active listing rows with publicationStatus `eligible`. */
  countEligible: () => Promise<number>
  /** Documents in the live search listing index. */
  countIndexed: () => Promise<number>
  now?: () => Date
}

async function read(fn: () => Promise<number>, now: () => Date): Promise<HelmCountReading> {
  try {
    const value = await fn()
    return { value, availability: 'available', collectedAt: now().toISOString() }
  } catch {
    return { value: null, availability: 'unavailable', collectedAt: null }
  }
}

/**
 * Runs the four inventory readings independently; one failing never zeroes
 * or hides the others. Not an atomic snapshot.
 */
export async function collectHelmSummary(deps: HelmSummaryDeps): Promise<HelmSummary> {
  const now = deps.now ?? (() => new Date())
  const [stored, active, eligible, indexed] = await Promise.all([
    read(deps.countStored, now),
    read(deps.countActive, now),
    read(deps.countEligible, now),
    read(deps.countIndexed, now),
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
