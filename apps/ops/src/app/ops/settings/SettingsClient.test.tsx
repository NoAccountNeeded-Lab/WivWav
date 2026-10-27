// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsProvider } from './SettingsProvider'
import { SettingsClient } from './SettingsClient'

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('operator settings page', () => {
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
    fireEvent.click(within(screen.getByRole('region', { name: 'detail_crawl.batch_size' })).getByRole('button', { name: 'Reset to default' }))
    expect(await screen.findAllByRole('link', { name: /detail_crawl.batch_size: 50/ })).toBeDefined()
  })
})
