// @vitest-environment jsdom
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearWarmCache } from '@/lib/warm-data-cache'
import { HelmWorkspace } from './HelmWorkspace'
import { aggregate, problem } from './fixtures'
import { currentSearch, defaultWorld, installFetch, setUrl, type World } from './test-harness'

// Full-suite parallel runs can starve jsdom; the default 1s async wait is too tight.
configure({ asyncUtilTimeout: 5_000 })

vi.mock('next/navigation', async () => (await import('./test-harness')).navigationMock)

let world: World

function stubViewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

function renderHelm() {
  return render(<HelmWorkspace apiBaseUrl="/api/bff" environment="Development" />)
}

const SOURCE_PROBLEM = 'domain:source_error:source:s1'
const NODE = { id: 'n1', jobType: 'source-scrape', sourceId: 's1', parentRunId: null, status: 'failed', startedAt: '2026-10-04T09:00:00Z', finishedAt: '2026-10-04T09:01:00Z', succeededCount: 0, failedCount: 3, errorMessage: 'selector missing', children: [
  { id: 'n2', jobType: 'listing-resolve', sourceId: 's1', parentRunId: 'n1', status: 'succeeded', startedAt: '2026-10-04T09:02:00Z', finishedAt: '2026-10-04T09:03:00Z', succeededCount: 2, failedCount: 0, errorMessage: null, children: [] },
] }
const LOG = { ts: '2026-10-04T09:00:30Z', level: 'error', service: 'worker', message: 'Selector .price missing for s1', requestId: 'req-1', queue: 'source-scrape', jobId: '9', sourceId: 's1', stack: 'Error: boom\n at scrape', extra: { attempt: 2 } }

beforeEach(() => {
  clearWarmCache()
  setUrl('')
  stubViewport(false)
  world = defaultWorld()
  world.runTree = [NODE]
  world.logs = [LOG]
  installFetch(world)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('selection and sharing', () => {
  it('opens the inspector for a problem and puts the chain in the URL', async () => {
    renderHelm()
    fireEvent.click(await screen.findByRole('button', { name: /Inspect BLVD source is in error/ }))
    await waitFor(() => expect(currentSearch()).toContain(`problem=${encodeURIComponent(SOURCE_PROBLEM)}`))
    expect(currentSearch()).toContain('source=s1')
    const dialog = await screen.findByRole('dialog')
    for (const heading of ['What happened', 'Impact', 'Evidence']) {
      expect(within(dialog).getByRole('heading', { name: heading })).toBeTruthy()
    }
  })

  it('reopens the same investigation from a shared URL', async () => {
    setUrl(`problem=${encodeURIComponent(SOURCE_PROBLEM)}&source=s1&run=${encodeURIComponent('job:n2')}`)
    renderHelm()
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/listing-resolve run: succeeded/)).toBeTruthy()
    const path = within(dialog).getByRole('navigation', { name: 'Selection path' })
    expect(within(path).getAllByRole('button').map(button => button.textContent)).toEqual([
      expect.stringContaining('BLVD source is in error'), expect.stringContaining('BLVD'), expect.stringContaining('listing-resolve'),
    ])
  })

  it('walks the relationship chain with breadcrumbs, keeping parents and dropping children', async () => {
    setUrl(`problem=${encodeURIComponent(SOURCE_PROBLEM)}&source=s1&run=${encodeURIComponent('job:n1')}`)
    renderHelm()
    const dialog = await screen.findByRole('dialog')
    const path = within(dialog).getByRole('navigation', { name: 'Selection path' })
    fireEvent.click(within(path).getByRole('button', { name: /Source: BLVD/ }))
    await waitFor(() => expect(currentSearch()).not.toContain('run='))
    expect(currentSearch()).toContain('source=s1')
    expect(currentSearch()).toContain('problem=')
  })

  it('navigates source → run tree node → log, preserving context', async () => {
    setUrl('source=s1')
    renderHelm()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByText('Run tree'))
    fireEvent.click(await within(dialog).findByRole('button', { name: /source-scrape/ }))
    await waitFor(() => expect(currentSearch()).toContain('run=job%3An1'))
    expect(currentSearch()).toContain('source=s1')
    fireEvent.click(await within(await screen.findByRole('dialog')).findByText('Recent logs'))
    fireEvent.click(await screen.findByRole('button', { name: /Selector \.price missing/ }))
    await waitFor(() => expect(currentSearch()).toContain('log='))
    expect(currentSearch()).toContain('run=job%3An1')
  })
})

describe('inspector content', () => {
  it('keeps technical payloads and stacks collapsed until asked', async () => {
    setUrl(`source=s1&log=${encodeURIComponent('2026-10-04T09:00:30Z|9|req-1')}`)
    renderHelm()
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Selector .price missing for s1', { selector: 'p' })
    const payload = within(dialog).getByText('Technical payload').closest('details')
    const stack = within(dialog).getByText('Stack trace').closest('details')
    expect(payload?.open).toBe(false)
    expect(stack?.open).toBe(false)
    expect(within(dialog).getByText(/Impact unknown: a single log line/)).toBeTruthy()
  })

  it('says impact is unknown for a problem type without an impact model', async () => {
    world.aggregate = aggregate([problem({ fingerprint: 'sentry:99', source: 'sentry', evidenceId: '99', detail: 'TypeError in parser', href: 'https://sentry.example/issues/99' })])
    setUrl('problem=sentry%3A99')
    renderHelm()
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/^Impact unknown: no impact model/)).toBeTruthy()
    expect(within(dialog).getByText(/Scope unknown/)).toBeTruthy()
  })

  it('keeps a global enrichment problem global and offers no source', async () => {
    world.aggregate = aggregate([problem({ fingerprint: 'domain:geocode_failed:queue:geocode', evidenceId: 'queue:geocode', detail: '4 geocode jobs failed', severity: 'warning' })])
    setUrl('problem=domain%3Ageocode_failed%3Aqueue%3Ageocode')
    renderHelm()
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/Global: affects the platform/)).toBeTruthy()
    expect(within(dialog).queryByText(/Source:/)).toBeNull()
    expect(currentSearch()).not.toContain('source=')
  })

  it('shows a pipeline, run tree and logs as expandable evidence groups', async () => {
    setUrl('source=s1')
    renderHelm()
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('list', { name: 'Pipeline stages for this source' })).toBeTruthy()
    expect(within(dialog).getByText('Run tree').closest('details')?.open).toBe(false)
    fireEvent.click(within(dialog).getByText('Run tree'))
    expect(within(dialog).getByRole('list', { name: 'Run tree (actual lineage)' })).toBeTruthy()
    expect(within(dialog).getByRole('list', { name: 'Runs spawned by source-scrape' })).toBeTruthy()
  })

  it('says logs are unavailable instead of empty when the log backend is down', async () => {
    world.logs = 'fail'
    setUrl('source=s1')
    renderHelm()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByText('Recent logs'))
    expect(await within(dialog).findByText(/Recent logs unavailable/)).toBeTruthy()
  })

  it('explains when a selected source is not in the source list', async () => {
    setUrl('source=ghost')
    renderHelm()
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findAllByText(/Source ghost is not in the loaded source list/)).toHaveLength(4)
    expect(within(dialog).getByRole('button', { name: 'Run source now' }).getAttribute('aria-disabled')).toBe('true')
  })
})

describe('narrow dialog focus management', () => {
  it('is a modal dialog, makes the page inert, and focuses its heading', async () => {
    renderHelm()
    const opener = await screen.findByRole('button', { name: /Inspect BLVD source is in error/ })
    opener.focus()
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(document.querySelector('[inert]')).not.toBeNull()
    expect(document.activeElement?.id).toBe('helm-inspector-title')
  })

  it('traps Tab inside the dialog in both directions', async () => {
    setUrl('source=s1')
    renderHelm()
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('list', { name: 'Pipeline stages for this source' })
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button, a[href], summary'))
    const last = focusable[focusable.length - 1] as HTMLElement
    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(focusable[0])
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('closes on Escape and restores focus to the control that opened it', async () => {
    renderHelm()
    const opener = await screen.findByRole('button', { name: /Inspect BLVD source is in error/ })
    opener.focus()
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(currentSearch()).toBe('')
    expect(document.activeElement).toBe(opener)
    expect(document.querySelector('[inert]')).toBeNull()
  })

  it('falls back to the section heading when the opener is gone', async () => {
    setUrl('section=problems&source=s1')
    renderHelm()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(document.body)
  })
})

// react-resizable-panels measures with ResizeObserver and offset sizes, which
// jsdom lacks (same stubs as the docked-terminal preview tests).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('desktop inspector', () => {
  beforeEach(() => {
    stubViewport(true)
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 1400 })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 900 })
  })
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth')
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight')
  })

  it('is a nonmodal resizable side panel next to a usable overview', async () => {
    setUrl('source=s1')
    renderHelm()
    const aside = await screen.findByRole('complementary')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(aside.getAttribute('aria-modal')).toBeNull()
    expect(document.querySelector('[inert]')).toBeNull()
    const separator = screen.getByRole('separator', { name: 'Resize inspector' })
    expect(separator.getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('button', { name: 'Overview' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Inventory counts' })).toBeTruthy()
  })

  it('renders the inspector content once, never in both a panel and a dialog', async () => {
    setUrl('source=s1')
    renderHelm()
    await screen.findByRole('complementary')
    expect(screen.getAllByRole('heading', { name: 'What happened' })).toHaveLength(1)
  })

  it('closes with Escape from inside the inspector', async () => {
    setUrl('source=s1')
    renderHelm()
    const aside = await screen.findByRole('complementary')
    const close = within(aside).getByRole('button', { name: 'Close' })
    close.focus()
    fireEvent.keyDown(close, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())
  })
})
