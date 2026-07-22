// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunsClient } from './RunsClient'
import { OPS_INSPECTOR_SLOT_ID } from '@/components/Inspector/inspector-slot'

const mockPush = vi.fn()
const mockReplace = vi.fn()
const mockUsePathname = vi.fn()
const mockUseSearchParams = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => mockUsePathname(),
  useSearchParams: () => mockUseSearchParams(),
}))

interface PipelineStageFixture {
  stage: string
  queue: string
  pendingCount: number
  lastCompletedAt: string | null
  failedCount: number
  failedScopedToSource: boolean
  stalled: boolean
  latestFailedJobId: string | null
}

const FAILED_RUN = {
  id: 'run-1',
  sourceId: 'source-1',
  sourceName: 'Acme Motors',
  startedAt: '2026-07-20T10:00:00.000Z',
  finishedAt: '2026-07-20T10:05:00.000Z',
  success: false,
  listingsFound: 10,
  listingsNew: 2,
  listingsUpdated: 1,
  errorMessage: 'Timeout fetching listing index',
}

const SUCCESS_RUN = {
  id: 'run-2',
  sourceId: 'source-2',
  sourceName: 'Beta Vans',
  startedAt: '2026-07-20T09:00:00.000Z',
  finishedAt: '2026-07-20T09:02:00.000Z',
  success: true,
  listingsFound: 5,
  listingsNew: 1,
  listingsUpdated: 0,
  errorMessage: null,
}

const RUNS = [FAILED_RUN, SUCCESS_RUN]

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function stubFetch(pipelineStages: PipelineStageFixture[] = []) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/admin/runs')) {
      return Promise.resolve(jsonResponse(RUNS))
    }
    if (url.includes('/pipeline')) {
      return Promise.resolve(jsonResponse({
        source: { id: 'source-1', name: 'Acme Motors' },
        generatedAt: '2026-07-20T10:06:00.000Z',
        stages: pipelineStages,
      }))
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  }))
}

describe('RunsClient', () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue('/ops/runs')
    // In production `OpsLayout` always mounts one `OpsShell` (and its inspector slot)
    // above every `/ops/*` route; recreate that slot so `InspectorPortal` has
    // somewhere to portal into, same as `InspectorPortal.test.tsx`.
    const slot = document.createElement('div')
    slot.id = OPS_INSPECTOR_SLOT_ID
    document.body.appendChild(slot)
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('opens the E6 inspector by pushing the run id onto the URL (no identifier typed or copied)', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams(''))
    stubFetch()

    render(<RunsClient apiBaseUrl="http://api.test" />)

    const detailsButtons = await screen.findAllByRole('button', { name: /view run details/i })
    fireEvent.click(detailsButtons[0]!)

    expect(mockPush).toHaveBeenCalledWith('/ops/runs?run=run-1', { scroll: false })
  })

  it('is reload-safe: a URL that already contains ?run= renders the inspector open with logs-for-this-run and source-detail links', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('run=run-1'))
    stubFetch([
      { stage: 'source-scrape', queue: 'source-scrape', pendingCount: 0, lastCompletedAt: null, failedCount: 1, failedScopedToSource: true, stalled: false, latestFailedJobId: null },
    ])

    render(<RunsClient apiBaseUrl="http://api.test" />)

    const dialog = await screen.findByRole('dialog')
    const logsLink = within(dialog).getByRole('link', { name: 'Logs for this run' })
    const href = logsLink.getAttribute('href')
    expect(href).toContain('/ops/logs?')
    expect(href).toContain('service=scraper')
    expect(href).toContain(`search=${FAILED_RUN.sourceId}`)
    expect(href).toContain(`start=${encodeURIComponent(FAILED_RUN.startedAt)}`)
    expect(href).toContain(`end=${encodeURIComponent(FAILED_RUN.finishedAt)}`)

    const sourceLink = within(dialog).getByRole('link', { name: 'Source detail' })
    expect(sourceLink.getAttribute('href')).toBe(`/ops/sources/${FAILED_RUN.sourceId}`)
  })

  it('hides the failed-job link (no dead link) when latestFailedJobId is absent, and shows it when present', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('run=run-1'))
    stubFetch([
      { stage: 'source-scrape', queue: 'source-scrape', pendingCount: 0, lastCompletedAt: null, failedCount: 1, failedScopedToSource: true, stalled: false, latestFailedJobId: null },
    ])

    render(<RunsClient apiBaseUrl="http://api.test" />)
    const dialog = await screen.findByRole('dialog')
    // Base run details render before the async pipeline fetch resolves.
    await within(dialog).findByRole('link', { name: 'Logs for this run' })
    expect(within(dialog).queryByText(/latest source-scrape failure/i)).toBeNull()

    cleanup()
    vi.clearAllMocks()
    mockUsePathname.mockReturnValue('/ops/runs')
    mockUseSearchParams.mockReturnValue(new URLSearchParams('run=run-1'))
    stubFetch([
      { stage: 'source-scrape', queue: 'source-scrape', pendingCount: 0, lastCompletedAt: null, failedCount: 1, failedScopedToSource: true, stalled: false, latestFailedJobId: 'job-abc-123' },
    ])

    render(<RunsClient apiBaseUrl="http://api.test" />)
    const dialog2 = await screen.findByRole('dialog')
    const jobLink = await within(dialog2).findByRole('link', { name: 'job-abc-123' })
    expect(jobLink.getAttribute('href')).toBe('/ops/logs?search=job-abc-123')
  })

  it('opening the inspector on a successful run never fetches pipeline data and never shows a failed-job link', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('run=run-2'))
    stubFetch()

    render(<RunsClient apiBaseUrl="http://api.test" />)
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('link', { name: 'Source detail' })

    expect(within(dialog).queryByText(/latest source-scrape failure/i)).toBeNull()
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/pipeline'))).toBe(false)
  })

  it('shows "This run is no longer available" instead of a broken panel when the run id in the URL is unknown', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('run=does-not-exist'))
    stubFetch()

    render(<RunsClient apiBaseUrl="http://api.test" />)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/no longer available/i)).toBeDefined()
  })

  it('scopes the run list to a source via ?sourceId= (from a source\'s last-error link) and shows a clear-filter banner', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('sourceId=source-1&filter=failed'))
    stubFetch()

    render(<RunsClient apiBaseUrl="http://api.test" />)

    await screen.findAllByText('Acme Motors')
    expect(screen.queryByText('Beta Vans')).toBeNull()
    expect(screen.getByText(/filtered to source/i)).toBeDefined()
    expect(screen.getByRole('link', { name: /clear filter/i }).getAttribute('href')).toBe('/ops/runs')
  })
})
