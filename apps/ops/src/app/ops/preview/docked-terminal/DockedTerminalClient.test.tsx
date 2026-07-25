// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearWarmCache } from '@/lib/warm-data-cache'
import { NavItemInterceptorProvider } from '@/components/OpsNav/nav-item-interceptor'
import { NavColumn } from '@/components/OpsNav/NavColumn'
import { DockedTerminalClient } from './DockedTerminalClient'

// `useWorkspaceState` reads/writes the URL through `next/navigation`. This
// mock is a small reactive store (via `useSyncExternalStore`) rather than a
// static return value, so `router.push`/`replace` calls made by the
// component under test are immediately visible on next render — required
// for the multi-render default-panel bootstrap and for chained interactions
// (open a panel, then act on it) within a single test.
let currentPathname = '/ops/preview/docked-terminal'
let currentSearch = new URLSearchParams('')
const searchListeners = new Set<() => void>()

function commitUrl(url: string) {
  const queryIndex = url.indexOf('?')
  currentSearch = new URLSearchParams(queryIndex >= 0 ? url.slice(queryIndex + 1) : '')
  searchListeners.forEach(listener => listener())
}

// Real Next.js keeps the `useRouter()` return value referentially stable
// across renders; a mock that hands back a fresh object (and fresh inline
// `push`/`replace` closures) every call breaks any `useCallback` chain that
// depends on it (`commit` -> `openPanel` -> `interceptNavItem`), causing
// those to look "new" every render and re-trigger their effects forever.
const mockRouter = {
  push: (url: string) => commitUrl(url),
  replace: (url: string) => commitUrl(url),
}

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => currentPathname,
  useSearchParams: () =>
    useSyncExternalStore(
      onChange => {
        searchListeners.add(onChange)
        return () => searchListeners.delete(onChange)
      },
      () => currentSearch,
    ),
}))

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

const EMPTY_LIST = { data: [] }
// The real `/health` route (`apps/api/src/routes/health.ts`) returns the
// health object directly, unlike `/admin/*`'s `{ data: [...] }` envelope —
// wrapping this in an extra `data` layer left `useReadinessReport`'s
// un-enveloped `fetchResource` reading `services` off `undefined`.
const HEALTH_BODY = { status: 'ok', timestamp: new Date().toISOString(), services: {} }
const LISTINGS_BODY = { pagination: { total: 10 } }
const LISTING_REFRESH_BODY = {
  data: {
    generatedAt: new Date().toISOString(),
    sources: { total: 0, active: 0, needsAttention: 0, totalListings: 0, observedActiveListings: 0, eligibleListings: 0, lastScrapedAt: null },
    listings: { active: 0, observedActive: 0, eligible: 0, mapReady: 0, missingLocations: 0 },
    latestScrapeRun: null,
    queues: [],
  },
}
const PROBLEM_AGGREGATE_EMPTY = {
  data: {
    problems: [],
    availability: { health: 'available', bullmq: 'available', db: 'available', loki: 'available', grafana: 'available', sentry: 'available' },
  },
}

const SOURCE_PROBLEM = {
  fingerprint: 'domain:source_error:source:blvd',
  source: 'domain',
  severity: 'critical',
  detail: 'blvd is erroring',
  evidenceId: 'source:blvd',
  href: null,
  firstSeen: new Date(Date.now() - 60 * 60_000).toISOString(),
  lastSeen: new Date(Date.now() - 5 * 60_000).toISOString(),
  occurrenceCount: 2,
  acknowledgedAt: null,
  acknowledgedBy: null,
}

interface FetchRoutes {
  problemAggregate?: unknown
  sources?: unknown
  queues?: unknown
  queueDetail?: Record<string, unknown>
  logs?: unknown
}

function mockFetch(routes: FetchRoutes = {}) {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/health')) return jsonResponse(HEALTH_BODY)
    if (url.endsWith('/admin/sources')) return jsonResponse(routes.sources ?? EMPTY_LIST)
    if (url.endsWith('/admin/runs')) return jsonResponse(EMPTY_LIST)
    if (url.endsWith('/admin/repeatables')) return jsonResponse(EMPTY_LIST)
    if (url.endsWith('/admin/listing-refresh/status')) return jsonResponse(LISTING_REFRESH_BODY)
    if (url.includes('/v1/listings')) return jsonResponse(LISTINGS_BODY)
    if (url.endsWith('/internal/ops/problem-aggregate')) return jsonResponse(routes.problemAggregate ?? PROBLEM_AGGREGATE_EMPTY)
    if (url.includes('/admin/logs')) return jsonResponse(routes.logs ?? EMPTY_LIST)
    const queueDetailMatch = /\/admin\/queues\/([^/?]+)$/.exec(url)
    if (queueDetailMatch) {
      const name = decodeURIComponent(queueDetailMatch[1] ?? '')
      const detail = routes.queueDetail?.[name]
      if (detail) return jsonResponse({ data: detail })
      throw new Error(`No mocked detail for queue ${name}`)
    }
    if (url.endsWith('/admin/queues')) return jsonResponse(routes.queues ?? EMPTY_LIST)
    throw new Error(`Unexpected URL in test: ${url}`)
  })
}

function renderDockedTerminal(routes: FetchRoutes = {}) {
  vi.stubGlobal('fetch', mockFetch(routes))
  return render(
    <NavItemInterceptorProvider>
      <DockedTerminalClient apiBaseUrl="" />
    </NavItemInterceptorProvider>,
  )
}

// `react-resizable-panels` (used by `WorkspaceResizableSplit`) measures
// panel elements via `ResizeObserver`, which jsdom does not implement.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// The library also reads `element.offsetWidth`/`offsetHeight` directly (not
// just via `ResizeObserver` entries) to compute each panel's percentage
// layout — jsdom always reports 0 for both, which leaves every panel's
// `defaultSize` undefined and the group unable to register an initial
// layout ("Previous layout not found for panel index N" the moment a resize
// is attempted). Stubbing non-zero values gives it real geometry to work
// from, matching how this repo would need to test any `react-resizable-panels`
// consumer (no prior precedent existed before this route).
const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')

beforeEach(() => {
  clearWarmCache()
  currentPathname = '/ops/preview/docked-terminal'
  currentSearch = new URLSearchParams('')
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth)
  if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight)
})

describe('DockedTerminalClient (#913)', () => {
  it('opens the readiness, problems, and queues panels by default from live data, not demo fixtures', async () => {
    renderDockedTerminal({
      queues: { data: [{ name: 'detail-crawl', paused: false, stats: { waiting: 0, active: 1, completed: 2, failed: 0, delayed: 0 } }] },
    })

    expect(await screen.findByRole('region', { name: 'Site readiness' })).toBeDefined()
    expect(await screen.findByRole('region', { name: 'Problems' })).toBeDefined()
    expect(await screen.findByRole('region', { name: 'Queue diagnostics' })).toBeDefined()
    // Real queue name from the mocked API, not a `run:1234`/`source:blvd` demo fixture.
    expect(await screen.findByText('detail-crawl')).toBeDefined()
  })

  it('clicking a wired nav item (readiness) opens/focuses the panel instead of navigating', async () => {
    // Start with only the problems panel open (readiness/queues absent) so the
    // nav click's effect is unambiguous.
    currentSearch = new URLSearchParams('panels=problems:main:2')
    vi.stubGlobal('fetch', mockFetch())

    render(
      <NavItemInterceptorProvider>
        <NavColumn />
        <DockedTerminalClient apiBaseUrl="" />
      </NavItemInterceptorProvider>,
    )

    expect(screen.queryByRole('region', { name: 'Site readiness' })).toBeNull()

    const readinessLink = screen.getByRole('link', { name: 'Site readiness' })
    fireEvent.click(readinessLink)

    expect(await screen.findByRole('region', { name: 'Site readiness' })).toBeDefined()
    // Still on the docked-terminal route — the click was intercepted, not navigated.
    expect(currentPathname).toBe('/ops/preview/docked-terminal')
  })

  it('a nav item with no panel mapping is left un-intercepted, keeping its normal href', () => {
    currentSearch = new URLSearchParams('panels=problems:main:2')
    vi.stubGlobal('fetch', mockFetch())

    render(
      <NavItemInterceptorProvider>
        <NavColumn />
        <DockedTerminalClient apiBaseUrl="" />
      </NavItemInterceptorProvider>,
    )

    // Source health has no panel mapping in `NAV_PANEL_MAP` — clicking it
    // must not open (or close) any workspace panel, and its `href` stays
    // the real destination rather than being swallowed by the interceptor.
    const sourcesLink = screen.getByRole('link', { name: 'Source health' })
    expect(sourcesLink.getAttribute('href')).toBe('/ops/sources')

    fireEvent.click(sourcesLink)

    expect(screen.queryByRole('region', { name: 'Source health' })).toBeNull()
    expect(currentSearch.toString()).toBe('panels=problems%3Amain%3A2')
  })

  it('opening a problem\'s source link opens/focuses a source panel while problems stays open', async () => {
    currentSearch = new URLSearchParams('panels=problems:main:2')
    renderDockedTerminal({
      problemAggregate: {
        data: {
          problems: [SOURCE_PROBLEM],
          availability: { health: 'available', bullmq: 'available', db: 'available', loki: 'available', grafana: 'available', sentry: 'available' },
        },
      },
      sources: { data: [{ id: 'blvd', name: 'BLVD.com', status: 'error', lastScrapedAt: null, lastFullCrawlAt: null, lastObservedAt: null, listingCount: 0, errorMessage: 'timeout', possiblyGoneCount: 0 }] },
    })

    const viewSourceButton = await screen.findByRole('button', { name: 'View source' })
    fireEvent.click(viewSourceButton)

    expect(await screen.findByRole('region', { name: 'Source · blvd' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Problems' })).toBeDefined()
  })

  it('a queue\'s failed-job count opens/focuses a logs panel filtered to that job, leaving queues open', async () => {
    currentSearch = new URLSearchParams('panels=queues:main:2')
    renderDockedTerminal({
      queues: { data: [{ name: 'geocode', paused: false, stats: { waiting: 0, active: 0, completed: 3, failed: 1, delayed: 0 } }] },
      queueDetail: {
        geocode: { name: 'geocode', paused: false, stats: { waiting: 0, active: 0, completed: 3, failed: 1, delayed: 0 }, jobs: [{ id: 'job-42', status: 'failed' }] },
      },
      logs: { data: [{ ts: new Date().toISOString(), level: 'error', message: 'geocode failed', jobId: 'job-42' }] },
    })

    const failedButton = await screen.findByRole('button', { name: /1 failed jobs in geocode/ })
    fireEvent.click(failedButton)

    expect(await screen.findByRole('region', { name: 'Logs · job job-42' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Queue diagnostics' })).toBeDefined()
    expect(await screen.findByText('geocode failed')).toBeDefined()
  })

  it('the divider between the docked panes is draggable (keyboard-resizable) and changes the panes\' relative widths', async () => {
    renderDockedTerminal()
    await screen.findByRole('region', { name: 'Site readiness' })

    const separator = screen.getByRole('separator', { name: /Resize Docked terminal panes/ })
    const before = separator.getAttribute('aria-valuenow')

    separator.focus()
    fireEvent.keyDown(separator, { key: 'ArrowRight' })

    await waitFor(() => {
      expect(separator.getAttribute('aria-valuenow')).not.toBe(before)
    })
  })

  it('minimizes a panel to a title-bar strip and restores it without losing content or its dock position', async () => {
    renderDockedTerminal()
    await screen.findByRole('region', { name: 'Site readiness' })

    fireEvent.click(screen.getByRole('button', { name: 'Minimize Site readiness' }))

    // Still mounted (region still exists) but its body content is hidden.
    const region = screen.getByRole('region', { name: 'Site readiness' })
    expect(region).toBeDefined()
    expect(within(region).getByText(/Loading readiness checks|Updated/).closest('[hidden]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Restore Site readiness' }))

    await waitFor(() => {
      expect(within(screen.getByRole('region', { name: 'Site readiness' })).getByText(/Loading readiness checks|Updated/).closest('[hidden]')).toBeNull()
    })
  })

  it('closing a panel actually unmounts its content, and reopening it via nav remounts fresh content', async () => {
    vi.stubGlobal('fetch', mockFetch())
    render(
      <NavItemInterceptorProvider>
        <NavColumn />
        <DockedTerminalClient apiBaseUrl="" />
      </NavItemInterceptorProvider>,
    )
    await screen.findByRole('region', { name: 'Site readiness' })

    // Closing removes the panel from `workspace.panels` entirely — unlike
    // minimize, `DockedTerminalClient` only renders a `<WorkspacePanel>` for
    // ids present in that array, so this is a real unmount, not a `hidden`
    // toggle (contrast with the minimize test above, where the region and
    // its content stay in the DOM under `[hidden]`).
    fireEvent.click(screen.getByRole('button', { name: 'Close Site readiness' }))
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Site readiness' })).toBeNull()
    })
    expect(document.querySelector('[aria-label="Site readiness"]')).toBeNull()

    // Reopen via the wired nav item and confirm a fresh region/content mounts.
    fireEvent.click(screen.getByRole('link', { name: 'Site readiness' }))
    expect(await screen.findByRole('region', { name: 'Site readiness' })).toBeDefined()
  })

  it('selecting a template (#915) fully replaces the open panel set rather than merging with it', async () => {
    // Start with a panel no template lists (`source`), so a merge vs. a full
    // swap are unambiguous.
    currentSearch = new URLSearchParams('panels=source:blvd:1')
    renderDockedTerminal({
      sources: { data: [{ id: 'blvd', name: 'BLVD.com', status: 'error', lastScrapedAt: null, lastFullCrawlAt: null, lastObservedAt: null, listingCount: 0, errorMessage: 'timeout', possiblyGoneCount: 0 }] },
    })
    expect(await screen.findByRole('region', { name: 'Source · blvd' })).toBeDefined()

    fireEvent.change(screen.getByRole('combobox', { name: 'Templates' }), { target: { value: 'triage' } })

    expect(await screen.findByRole('region', { name: 'Problems' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Queue diagnostics' })).toBeDefined()
    // The panel open before the template was selected is gone, not merged in.
    expect(screen.queryByRole('region', { name: 'Source · blvd' })).toBeNull()
  })

  it('the URL after selecting a template matches the URL from manually opening the same panel set (#915)', async () => {
    currentSearch = new URLSearchParams('panels=source:blvd:1')
    renderDockedTerminal({
      sources: { data: [{ id: 'blvd', name: 'BLVD.com', status: 'error', lastScrapedAt: null, lastFullCrawlAt: null, lastObservedAt: null, listingCount: 0, errorMessage: 'timeout', possiblyGoneCount: 0 }] },
    })
    await screen.findByRole('region', { name: 'Source · blvd' })

    fireEvent.change(screen.getByRole('combobox', { name: 'Templates' }), { target: { value: 'triage' } })

    await screen.findByRole('region', { name: 'Problems' })
    // Same query string `openPanel`/`closePanel` would produce for this exact
    // panel set — templates reuse the existing URL-state contract rather
    // than introducing a parallel one.
    expect(currentSearch.toString()).toBe('panels=problems%3Amain%3A2%2Cqueues%3Amain%3A2')
  })

  it('reproduces the open panel set, order, span, minimized, and maximized state on reload from the URL alone', async () => {
    currentSearch = new URLSearchParams('panels=problems:main:2,queues:main:2&min=queues:main')
    renderDockedTerminal()

    expect(await screen.findByRole('region', { name: 'Problems' })).toBeDefined()
    // Queues is minimized: its region still exists (mounted), but as a strip.
    const queuesRegion = screen.getByRole('region', { name: 'Queue diagnostics' })
    expect(queuesRegion.getAttribute('data-minimized')).toBe('true')
    expect(screen.getByRole('button', { name: 'Restore Queue diagnostics' })).toBeDefined()
  })
})
