import { describe, expect, it } from 'vitest'
import { applyJobObservation } from './tracked-action'
import { action, T0 } from './fixtures'

const pending = () => action({ outcome: 'queued', terminalObservedAtMs: null, jobCreatedAtMs: null, jobFinishedAtMs: null })
const job = (over = {}) => ({ id: '7', status: 'running' as const, createdAt: new Date(T0 + 1_000).toISOString(), finishedAt: null, failedReason: null, ...over })

describe('applyJobObservation', () => {
  it('moves queued → running → completed and stamps the client observation time once', () => {
    const running = applyJobObservation(pending(), { kind: 'job', job: job() }, T0 + 5_000)
    expect(running.outcome).toBe('running')
    const done = applyJobObservation(running, { kind: 'job', job: job({ status: 'completed', finishedAt: new Date(T0 + 30_000).toISOString() }) }, T0 + 31_000)
    expect(done).toMatchObject({ outcome: 'completed', terminalObservedAtMs: T0 + 31_000 })
    expect(applyJobObservation(done, { kind: 'job', job: job({ status: 'completed', finishedAt: new Date(T0 + 30_000).toISOString() }) }, T0 + 99_000).terminalObservedAtMs).toBe(T0 + 31_000)
  })

  it('records the failure reason', () => {
    const failed = applyJobObservation(pending(), { kind: 'job', job: job({ status: 'failed', finishedAt: new Date(T0 + 20_000).toISOString(), failedReason: 'timeout' }) }, T0 + 21_000)
    expect(failed).toMatchObject({ outcome: 'failed', detail: 'timeout' })
  })

  it('a job missing from the queue list is unavailable, never completed', () => {
    const missing = applyJobObservation(pending(), { kind: 'job', job: null }, T0 + 5_000)
    expect(missing.outcome).toBe('unavailable')
    expect(missing.detail).toMatch(/not in the source-scrape retained job list/)
  })

  it('keeps the last known outcome and records a check error when the status request fails', () => {
    const next = applyJobObservation({ ...pending(), outcome: 'running' }, { kind: 'error', message: 'API returned 503' }, T0 + 5_000)
    expect(next).toMatchObject({ outcome: 'running', checkError: 'Status check failed: API returned 503' })
  })

  it('does not adopt a retained job that finished before this request (fixed-id rebuild)', () => {
    const rebuild = action({ kind: 'search-rebuild', queue: 'listing-sync', jobId: 'listing-sync-rebuild', outcome: 'queued', terminalObservedAtMs: null })
    const stale = applyJobObservation(rebuild, { kind: 'job', job: job({ id: 'listing-sync-rebuild', status: 'completed', finishedAt: new Date(T0 - 3_600_000).toISOString() }) }, T0 + 2_000)
    expect(stale.outcome).toBe('unavailable')
    expect(stale.detail).toMatch(/finished before this request/)
  })
})
