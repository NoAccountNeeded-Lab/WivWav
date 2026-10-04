// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearWarmCache } from '@/lib/warm-data-cache'
import { HelmWorkspace } from './HelmWorkspace'
import { aggregate, problem, run, source, summary } from './fixtures'
import { currentSearch, defaultWorld, installFetch, setUrl, type World } from './test-harness'

vi.mock('next/navigation', async () => (await import('./test-harness')).navigationMock)

const SOURCE_PROBLEM = 'domain:source_error:source:s1'
let world: World

function renderHelm() {
  return render(<HelmWorkspace apiBaseUrl="/api/bff" environment="Development" />)
}

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString()

/**
 * Advances fake time in separate `act` steps. One big act would defer React's
 * renders until it exits, so interval ticks would all see stale state — a test
 * artifact; a real browser renders between ticks.
 */
async function advance(ms: number) {
  if (ms === 0) {
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    return
  }
  for (let remaining = ms; remaining > 0; remaining -= 2_500) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(2_500, remaining)) })
  }
}

async function openSourceInspector(focus: 'source' | 'problem' = 'source') {
  setUrl(`problem=${encodeURIComponent(SOURCE_PROBLEM)}&source=s1${focus === 'problem' ? '&focus=problem' : ''}`)
  renderHelm()
  await advance(0)
  return screen.getByRole('dialog')
}

function posts(path: string) {
  return world.calls.filter(call => call.method === 'POST' && call.path === path)
}

/** Source scrape accepted as job 77; later calls move it to running/completed. */
function acceptRun(jobId = '77') {
  world.posts['POST /admin/sources/s1/run'] = () => ({ status: 201, body: { data: { id: jobId } } })
}

function jobIs(status: string, extra: Record<string, unknown> = {}) {
  world.jobs['source-scrape'] = [{ id: '77', name: 'source-scrape', status, createdAt: iso(-1_000), ...extra }]
}

beforeEach(() => {
  vi.useFakeTimers()
  clearWarmCache()
  setUrl('')
  world = defaultWorld()
  installFetch(world)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('source targeting and control availability', () => {
  it('runs only the selected source and shows the returned job id as queued', async () => {
    acceptRun()
    const dialog = await openSourceInspector()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run source now' }))
    await advance(0)

    expect(posts('/admin/sources/s1/run')).toHaveLength(1)
    expect(world.calls.filter(call => call.path.includes('/admin/sources/s2/run'))).toHaveLength(0)
    const list = within(dialog).getByRole('list', { name: 'Actions for this source' })
    expect(list.textContent).toMatch(/Run source now: BLVD/)
    expect(list.textContent).toMatch(/Queued/)
    expect(list.textContent).toMatch(/job 77/)
  })

  it('sends the selected source id when crawling or extracting details', async () => {
    world.posts['POST /admin/queues/detail-crawl/jobs'] = () => ({ status: 201, body: { data: { id: 'c1' } } })
    world.posts['POST /admin/queues/detail-extract/jobs'] = () => ({ status: 201, body: { data: { id: 'e1' } } })
    const dialog = await openSourceInspector()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run detail crawl' }))
    await advance(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run detail extraction' }))
    await advance(0)
    expect(posts('/admin/queues/detail-crawl/jobs')[0]?.body).toEqual({ data: { sourceId: 's1' } })
    expect(posts('/admin/queues/detail-extract/jobs')[0]?.body).toEqual({ data: { sourceId: 's1' } })
  })

  it('disables controls for a paused source and says why, without sending anything', async () => {
    setUrl('source=s2')
    renderHelm()
    await advance(0)
    const dialog = screen.getByRole('dialog')
    const button = within(dialog).getByRole('button', { name: 'Run source now' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(within(dialog).getAllByText('Paused Co is paused and cannot be run.')).not.toHaveLength(0)
    fireEvent.click(button)
    await advance(0)
    expect(world.calls.filter(call => call.method === 'POST' && call.path !== '/internal/ops/problem-aggregate')).toHaveLength(0)
  })

  it('offers no source controls for a global problem and keeps it global', async () => {
    world.aggregate = aggregate([problem({ fingerprint: 'domain:geocode_failed:queue:geocode', evidenceId: 'queue:geocode', detail: 'geocode failed', severity: 'warning' })])
    setUrl('problem=domain%3Ageocode_failed%3Aqueue%3Ageocode')
    renderHelm()
    await advance(0)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Run source now' })).toBeNull()
    expect(within(dialog).getByText(/This problem is global, so there is no source to run/)).toBeTruthy()
  })

  it('does not let a double click enqueue twice while the first is pending', async () => {
    acceptRun()
    const dialog = await openSourceInspector()
    const button = within(dialog).getByRole('button', { name: 'Run source now' })
    fireEvent.click(button)
    fireEvent.click(button)
    await advance(0)
    expect(posts('/admin/sources/s1/run')).toHaveLength(1)
    expect(within(dialog).getAllByText('This action is already queued or running for this source.')).not.toHaveLength(0)
  })
})

describe('enqueue failures', () => {
  it('shows the API status, code and message and tracks no job', async () => {
    world.posts['POST /admin/sources/s1/run'] = () => ({ status: 409, body: { error: { code: 'SOURCE_DISABLED', message: 'Source "BLVD" is paused and cannot be run' } } })
    const dialog = await openSourceInspector()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run source now' }))
    await advance(0)
    const alert = within(dialog).getByRole('alert')
    expect(alert.textContent).toMatch(/HTTP 409 SOURCE_DISABLED/)
    expect(alert.textContent).toMatch(/paused and cannot be run/)
    expect(alert.textContent).toMatch(/No job was queued/)
    await advance(60_000)
    expect(world.calls.filter(call => call.path === '/admin/queues/source-scrape')).toHaveLength(0)
  })

  it('lists a rejected request under Activity as "Request rejected", never as a failed job', async () => {
    world.posts['POST /admin/sources/s1/run'] = () => ({ status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Queue service is unavailable' } } })
    const dialog = await openSourceInspector()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run source now' }))
    await advance(0)
    const tracked = screen.getByRole('list', { name: 'Tracked actions' })
    expect(tracked.textContent).toMatch(/The request was not accepted \(HTTP 503 SERVICE_UNAVAILABLE\)/)
    expect(tracked.textContent).toMatch(/Request rejected/)
    expect(tracked.textContent).toMatch(/No job was queued/)
    expect(tracked.textContent).not.toMatch(/the job failed/i)
    expect(tracked.textContent).not.toMatch(/Not recovered/)
  })

  it('reports a rate-limited rebuild as a failure, not a queued job', async () => {
    world.posts['POST /admin/sync'] = () => ({ status: 429, body: { error: { code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded' } } })
    renderHelm()
    await advance(0)
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild search index…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild now' }))
    await advance(0)
    const list = screen.getByRole('list', { name: 'Search rebuild requests' })
    expect(list.textContent).toMatch(/HTTP 429 TOO_MANY_REQUESTS/)
    expect(list.textContent).toMatch(/No job was queued/)
  })

  it('reports an enqueue response without a job id as a failure', async () => {
    world.posts['POST /admin/sources/s1/run'] = () => ({ status: 201, body: { data: {} } })
    const dialog = await openSourceInspector()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run source now' }))
    await advance(0)
    expect(within(dialog).getByRole('alert').textContent).toMatch(/UNEXPECTED_RESPONSE|unexpected response/)
  })
})

describe('completion is not recovery', () => {
  async function runToCompletion() {
    acceptRun()
    const dialog = await openSourceInspector()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run source now' }))
    await advance(0)
    jobIs('active')
    await advance(10_000)
    expect(within(dialog).getByRole('list', { name: 'Actions for this source' }).textContent).toMatch(/Running/)
    return dialog
  }

  function finishJob() {
    jobIs('completed', { finishedAt: iso(500) })
    world.runs = [run({ id: 'r-new', startedAt: iso(300), finishedAt: iso(900), success: true })]
    world.sources = [source({ status: 'active' }), source({ id: 's2', name: 'Paused Co', status: 'paused' })]
  }

  it('a completed job with the problem still reported is "Not recovered"', async () => {
    const dialog = await runToCompletion()
    finishJob() // problem still in the aggregate
    await advance(60_000)
    const list = within(dialog).getByRole('list', { name: 'Actions for this source' })
    expect(list.textContent).toMatch(/Completed/)
    expect(list.textContent).toMatch(/Not recovered/)
    expect(list.textContent).toMatch(/still reported/)
    expect(list.textContent).not.toMatch(/Recovery confirmed/)
  })

  it('confirms recovery only from fresh evidence after the job finished', async () => {
    const dialog = await runToCompletion()
    finishJob()
    world.aggregate = aggregate([])
    await advance(60_000)
    const list = within(dialog).getByRole('list', { name: 'Actions for this source' })
    expect(list.textContent).toMatch(/Recovery confirmed/)
    expect(list.textContent).toMatch(/not matched to the job by id/)
  })

  it('does not call it recovered when the problem vanished because signals are unavailable', async () => {
    const dialog = await runToCompletion()
    finishJob()
    world.aggregate = aggregate([], { db: 'unavailable' })
    await advance(60_000)
    const list = within(dialog).getByRole('list', { name: 'Actions for this source' })
    expect(list.textContent).toMatch(/Recovery unconfirmed/)
    expect(list.textContent).toMatch(/not proof it is fixed/)
    expect(list.textContent).not.toMatch(/Recovery confirmed/)
  })

  it('announces outcome and recovery changes in one polite live region', async () => {
    const dialog = await runToCompletion()
    const announcer = screen.getByTestId('action-announcer')
    expect(announcer.getAttribute('role')).toBe('status')
    expect(announcer.getAttribute('aria-live')).toBe('polite')
    expect(announcer.textContent).toMatch(/Run source now: BLVD\. Running/)
    finishJob()
    world.aggregate = aggregate([])
    await advance(60_000)
    expect(announcer.textContent).toMatch(/Run source now: BLVD\. Completed\. Recovery confirmed/)
    expect(within(dialog).getAllByRole('status').length).toBeGreaterThan(0)
  })

  it('shows a failed job with its reason and no recovery', async () => {
    const dialog = await runToCompletion()
    jobIs('failed', { finishedAt: iso(500), failedReason: 'Navigation timeout' })
    await advance(10_000)
    const list = within(dialog).getByRole('list', { name: 'Actions for this source' })
    expect(list.textContent).toMatch(/Failed/)
    expect(list.textContent).toMatch(/Navigation timeout/)
    expect(list.textContent).toMatch(/Not recovered/)
  })

  it('reports status unavailable, not completed, when the job disappears from the queue list', async () => {
    const dialog = await runToCompletion()
    world.jobs['source-scrape'] = []
    await advance(10_000)
    const list = within(dialog).getByRole('list', { name: 'Actions for this source' })
    expect(list.textContent).toMatch(/Status unavailable/)
    expect(list.textContent).toMatch(/not in the source-scrape retained job list/)
    expect(list.textContent).not.toMatch(/Completed/)
  })

  it('keeps tracking after the inspector is closed and shows the verdict under Activity', async () => {
    const dialog = await runToCompletion()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await advance(0)
    expect(screen.queryByRole('dialog')).toBeNull()
    finishJob()
    world.aggregate = aggregate([])
    await advance(60_000)
    const tracked = screen.getByRole('list', { name: 'Tracked actions' })
    expect(tracked.textContent).toMatch(/Run source now: BLVD/)
    expect(tracked.textContent).toMatch(/Completed/)
    expect(tracked.textContent).toMatch(/Recovery confirmed/)
  })

  it('does not poll the queue while the tab is hidden', async () => {
    await runToCompletion()
    const before = world.calls.filter(call => call.path === '/admin/queues/source-scrape').length
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    await advance(60_000)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    expect(world.calls.filter(call => call.path === '/admin/queues/source-scrape').length).toBe(before)
  })
})

describe('search rebuild', () => {
  it('needs explicit confirmation and sends nothing when cancelled', async () => {
    renderHelm()
    await advance(0)
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild search index…' }))
    expect(screen.getByRole('group', { name: 'Rebuild the whole search index?' })).toBeTruthy()
    expect(posts('/admin/sync')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'Rebuild the whole search index?' })).toBeNull()
    expect(posts('/admin/sync')).toHaveLength(0)
  })

  it('tracks the returned job id and does not claim recovery for a healthy index', async () => {
    world.posts['POST /admin/sync'] = () => ({ status: 202, body: { data: { enqueued: true, jobId: 'listing-sync-rebuild' } } })
    renderHelm()
    await advance(0)
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild search index…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild now' }))
    await advance(0)
    expect(posts('/admin/sync')).toHaveLength(1)
    world.jobs['listing-sync'] = [{ id: 'listing-sync-rebuild', status: 'completed', createdAt: iso(-500), finishedAt: iso(500) }]
    await advance(70_000)
    const list = screen.getByRole('list', { name: 'Search rebuild requests' })
    expect(list.textContent).toMatch(/job <code>|job listing-sync-rebuild/)
    expect(list.textContent).toMatch(/Completed/)
    expect(list.textContent).toMatch(/no recovery is claimed/)
  })

  it('confirms recovery when search was unavailable before and the fresh reading shows documents', async () => {
    world.summary = summary({ search: 'unavailable', indexed: null })
    world.posts['POST /admin/sync'] = () => ({ status: 202, body: { data: { enqueued: true, jobId: 'listing-sync-rebuild' } } })
    renderHelm()
    await advance(0)
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild search index…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild now' }))
    await advance(0)
    world.jobs['listing-sync'] = [{ id: 'listing-sync-rebuild', status: 'completed', createdAt: iso(-500), finishedAt: iso(500) }]
    world.summary = { ...summary({ indexed: 70 }), counts: { ...summary({ indexed: 70 }).counts, indexed: { value: 70, availability: 'available', collectedAt: iso(5_000) } } }
    await advance(70_000)
    expect(screen.getByRole('list', { name: 'Search rebuild requests' }).textContent).toMatch(/Recovery confirmed/)
  })
})

describe('acknowledge means reviewed', () => {
  it('posts the fingerprint and acknowledged flag, and surfaces a failure', async () => {
    world.posts['POST /internal/ops/problem-ack'] = () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Problem fingerprint not found' } } })
    const dialog = await openSourceInspector('problem')
    fireEvent.click(within(dialog).getByRole('button', { name: /Acknowledge \(mark reviewed\)/ }))
    await advance(0)
    expect(posts('/internal/ops/problem-ack')[0]?.body).toEqual({ fingerprint: SOURCE_PROBLEM, acknowledged: true })
    expect(within(dialog).getByText(/Problem fingerprint not found \(HTTP 404\)/)).toBeTruthy()
    expect(within(dialog).getByText(/does not repair anything/)).toBeTruthy()
  })

  it('offers unacknowledge for a reviewed problem and keeps status off healthy', async () => {
    world.aggregate = aggregate([problem({ acknowledgedAt: iso(-1_000), acknowledgedBy: 'ops' })])
    const dialog = await openSourceInspector('problem')
    expect(within(dialog).getByRole('button', { name: /Unacknowledge \(mark not reviewed\)/ })).toBeTruthy()
    expect(within(dialog).getByText(/Reviewed by ops/)).toBeTruthy()
    expect(screen.queryByText('Healthy')).toBeNull()
  })
})

describe('shareable relationship navigation', () => {
  it('keeps the selection in the URL when moving from a problem to its run', async () => {
    const dialog = await openSourceInspector()
    expect(currentSearch()).toContain('source=s1')
    fireEvent.click(within(dialog).getByText('Source pipeline'))
    expect(within(dialog).getAllByRole('list', { name: 'Pipeline stages for this source' })).toHaveLength(1)
  })
})
