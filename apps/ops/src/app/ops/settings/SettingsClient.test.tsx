// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsClient } from './SettingsClient'
import { SettingsProvider, useSettings } from './SettingsProvider'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function ResetWithoutRow() {
  const { reset } = useSettings()
  return <button onClick={() => void reset('detail_crawl.batch_size')}>Reset missing setting</button>
}

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('settings page', () => {
  it('edits all 16 registry keys and preserves a save across reload until reset', async () => {
    const entries: Array<{ id: string; key: string; value: number; type: string; createdAt: string; createdBy: null }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const key = url.split('/admin/config/')[1]
      if (!key) return response(entries)
      if (init?.method === 'PUT') {
        const value = (JSON.parse(init.body as string) as { value: number }).value
        const row = { id: 'saved', key: decodeURIComponent(key), value, type: 'number', createdAt: new Date().toISOString(), createdBy: null }
        entries.splice(0, entries.length, row)
        return response(row)
      }
      if (init?.method === 'DELETE') { entries.splice(0); return response({ deleted: true }) }
      return response([])
    }))

    const view = render(<SettingsProvider apiBaseUrl="http://api.test"><SettingsClient /></SettingsProvider>)
    expect(await screen.findAllByRole('region')).toHaveLength(16)
    const section = screen.getByRole('region', { name: 'detail_crawl.batch_size' })
    fireEvent.click(within(section).getByRole('button', { name: 'Edit detail_crawl.batch_size' }))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '400' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findAllByRole('link', { name: /detail_crawl.batch_size: 400/ })).toBeDefined()

    view.unmount()
    render(<SettingsProvider apiBaseUrl="http://api.test"><SettingsClient /></SettingsProvider>)
    expect(await screen.findAllByRole('link', { name: /detail_crawl.batch_size: 400/ })).toBeDefined()
    fireEvent.click(within(screen.getByRole('region', { name: 'detail_crawl.batch_size' })).getByRole('button', { name: 'Reset detail_crawl.batch_size to default' }))
    expect(await screen.findAllByRole('link', { name: /detail_crawl.batch_size: 50/ })).toBeDefined()
  })
  it('labels reset controls and fetches history only after a mutation, not a refresh', async () => {
    let refresh: (() => void) | undefined
    const realSetInterval = window.setInterval.bind(window)
    vi.spyOn(window, 'setInterval').mockImplementation((callback, delay, ...args) => {
      if (delay === 60_000) { refresh = callback as () => void; return 1 as never }
      return realSetInterval(callback, delay, ...args) as never
    })
    const fetcher = vi.fn(async (url: string) => url.endsWith('/history')
      ? new Response(null, { status: 404 })
      : new Response(JSON.stringify({ data: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    render(<SettingsProvider apiBaseUrl="http://api.test"><SettingsClient selectedKey="detail_crawl.batch_size" /></SettingsProvider>)
    await screen.findByRole('button', { name: 'Reset detail_crawl.batch_size to default' })
    await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/history'))).toHaveLength(1))
    expect(refresh).toBeDefined()
    await act(async () => { refresh?.(); await Promise.resolve() })
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/admin/config'))).toHaveLength(2)
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/history'))).toHaveLength(1)
  })

  it('sends DELETE for a reset even when the local entry map is empty', async () => {
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => new Response(JSON.stringify({ data: options?.method === 'DELETE' ? { deleted: true } : [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    render(<SettingsProvider apiBaseUrl="http://api.test"><ResetWithoutRow /></SettingsProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Reset missing setting' }))
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(true))
  })

  it('clears a prior reset error after a successful retry', async () => {
    let deletes = 0
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/history')) return new Response(null, { status: 404 })
      if (options?.method === 'DELETE') {
        deletes += 1
        return new Response(JSON.stringify({ data: { deleted: true } }), { status: deletes === 1 ? 500 : 200 })
      }
      return new Response(JSON.stringify({ data: [{ id: 'row-1', key: 'detail_crawl.batch_size', value: 50, type: 'number', createdAt: new Date().toISOString(), createdBy: null }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    render(<SettingsProvider apiBaseUrl="http://api.test"><SettingsClient selectedKey="detail_crawl.batch_size" /></SettingsProvider>)
    const reset = await screen.findByRole('button', { name: 'Reset detail_crawl.batch_size to default' })
    await waitFor(() => expect(reset.hasAttribute('disabled')).toBe(false))
    fireEvent.click(reset)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Reset failed (500)')
    fireEvent.click(reset)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
