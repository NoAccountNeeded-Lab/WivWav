// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearWarmCache } from '@/lib/warm-data-cache'
import { HelmWorkspace } from './HelmWorkspace'
import { aggregate, summary } from './fixtures'
import { defaultWorld, installFetch, setUrl, setVisibility, type World } from './test-harness'

vi.mock('next/navigation', async () => (await import('./test-harness')).navigationMock)

let world: World

function renderHelm() {
  return render(<HelmWorkspace apiBaseUrl="/api/bff" environment="Development" />)
}

beforeEach(() => {
  clearWarmCache()
  setUrl('')
  world = defaultWorld()
  installFetch(world)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setVisibility('visible')
})

describe('Helm frame', () => {
  it('shows the title, environment, update time, refresh and a legacy ops link', async () => {
    renderHelm()
    expect(screen.getByRole('heading', { level: 1, name: 'Helm' })).toBeTruthy()
    expect(screen.getByText('Development')).toBeTruthy()
    expect(screen.getByRole('button', { name: /refresh/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Legacy ops' }).getAttribute('href')).toBe('/ops')
    await waitFor(() => expect(screen.getByText(/Updated/).textContent).not.toMatch(/not yet/))
  })

  it('lists the five sections with icon buttons and marks the selected one', async () => {
    renderHelm()
    const nav = screen.getByRole('navigation', { name: 'Helm sections' })
    for (const label of ['Overview', 'Inventory', 'Flow', 'Problems', 'Activity']) {
      expect(within(nav).getByRole('button', { name: label })).toBeTruthy()
    }
    expect(within(nav).getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(within(nav).getByRole('button', { name: 'Flow' }))
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Flow' }).getAttribute('aria-current')).toBe('true'))
    expect(within(nav).getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBeNull()
  })
})

describe('Inventory', () => {
  it('shows four independent counts and DB/search availability, with definitions on demand', async () => {
    renderHelm()
    const list = await screen.findByRole('list', { name: 'Inventory counts' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    expect(within(list).getByText('Stored listings')).toBeTruthy()
    expect(screen.getByText('Database: available')).toBeTruthy()
    expect(screen.getByText('Search: available')).toBeTruthy()
    const summaryEls = within(list).getAllByText('What does this count?')
    const details = summaryEls[3]?.closest('details')
    expect(details?.open).toBe(false)
    expect(details?.textContent).toMatch(/never unique vehicles/)
    expect(screen.getByText(/not an atomic snapshot/)).toBeTruthy()
  })

  it('shows Unavailable, never zero, for a failed reading', async () => {
    world.summary = summary({ search: 'unavailable', indexed: null })
    renderHelm()
    const list = await screen.findByRole('list', { name: 'Inventory counts' })
    const indexed = within(list).getByText('Indexed documents').closest('li') as HTMLElement
    expect(within(indexed).getByText('Unavailable')).toBeTruthy()
    expect(indexed.textContent).not.toMatch(/\b0\b/)
    expect(screen.getByText('Search: unavailable')).toBeTruthy()
  })

  it('shows no counts at all when the summary never loaded', async () => {
    world.summary = 'fail'
    renderHelm()
    await screen.findByText(/Inventory counts are unavailable/)
    expect(screen.queryByRole('list', { name: 'Inventory counts' })).toBeNull()
  })
})

describe('Flow and charts', () => {
  it('shows connected stages with work, exceptions and the lineage caveat, plus backlog numbers', async () => {
    renderHelm()
    const stages = await screen.findByRole('list', { name: /Pipeline stages/ })
    expect(within(stages).getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText(/does not pass through these stages in one serial line/)).toBeTruthy()
    const detail = within(stages).getByText('Detail processing').closest('li') as HTMLElement
    expect(detail.textContent).toMatch(/10 waiting, active or delayed/)
    const table = screen.getByRole('table', { name: /Backlog by queue/ })
    expect(within(table).getByText('detail-crawl')).toBeTruthy()
    expect(screen.getByText(/Not a trend/)).toBeTruthy()
  })

  it('marks backlog unknown rather than empty when queues are unavailable', async () => {
    world.queues = 'fail'
    renderHelm()
    await screen.findByText(/backlog is unknown \(not zero\)/)
    for (const item of within(screen.getByRole('list', { name: /Pipeline stages/ })).getAllByRole('listitem')) {
      expect(item.textContent).toMatch(/Unavailable/)
    }
  })

  it('labels the recent run window and offers the numbers', async () => {
    renderHelm()
    await screen.findByText(/Latest 1 of the 1 most recent scrape runs across all sources/, { selector: 'p' })
    expect(screen.getByText('Show numbers for these runs')).toBeTruthy()
  })
})

describe('Problems and status', () => {
  it('lists problems with severity icon+word, plain summary, affected entity and next action', async () => {
    renderHelm()
    const list = await screen.findByRole('list', { name: 'Problems' })
    const item = within(list).getAllByRole('listitem')[0] as HTMLElement
    expect(item.textContent).toMatch(/Critical/)
    expect(item.textContent).toMatch(/last scrape of this source failed/)
    expect(item.textContent).toMatch(/Affected:.*Source: BLVD/)
    expect(item.textContent).toMatch(/Next:.*Run the source now/)
  })

  it('never reports healthy when the problem aggregate is unavailable', async () => {
    world.aggregate = 'fail'
    renderHelm()
    await screen.findByText(/Problems are unavailable/)
    expect(screen.queryByText('Healthy')).toBeNull()
    expect(screen.getByText('Status unknown')).toBeTruthy()
  })

  it('reports healthy only with every resource fresh, all signals available and no problems', async () => {
    world.aggregate = aggregate([])
    world.sources = []
    world.runs = []
    renderHelm()
    await waitFor(() => expect(screen.getByText('Healthy')).toBeTruthy())
  })

  it('warns that an empty problem list is not proof when a signal is unavailable', async () => {
    world.aggregate = aggregate([], { grafana: 'unavailable' })
    renderHelm()
    await screen.findByText(/Unavailable problem signals: grafana/)
    expect(screen.queryByText('Healthy')).toBeNull()
  })
})

describe('Polling', () => {
  it('refreshes every 15s while visible, never while hidden, and refetches on return', async () => {
    vi.useFakeTimers()
    renderHelm()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const countSummary = () => world.calls.filter(call => call.path === '/internal/ops/helm-summary').length
    expect(countSummary()).toBe(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(countSummary()).toBe(2)

    setVisibility('hidden')
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(countSummary()).toBe(2)

    setVisibility('visible')
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(countSummary()).toBe(3)
  })

  it('does not start a second request while one is still in flight', async () => {
    vi.useFakeTimers()
    const hang = defaultWorld()
    const base = installFetch(hang)
    let summaryCalls = 0
    vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
      if (String(input).endsWith('/internal/ops/helm-summary')) {
        summaryCalls += 1
        return new Promise<Response>(() => { /* never settles */ })
      }
      return base(input, init)
    }))
    renderHelm()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(summaryCalls).toBe(1)
  })

  it('keeps the last successful inventory and marks it stale when a refresh fails', async () => {
    vi.useFakeTimers()
    renderHelm()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByRole('list', { name: 'Inventory counts' })).toBeTruthy()

    world.summary = 'fail'
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

    expect(screen.getByRole('list', { name: 'Inventory counts' })).toBeTruthy()
    expect(screen.getAllByText(/Stale/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Showing the last successful readings/)).toBeTruthy()
  })
})
