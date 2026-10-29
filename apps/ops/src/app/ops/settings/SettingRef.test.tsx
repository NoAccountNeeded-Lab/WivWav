// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsProvider } from './SettingsProvider'
import { SettingRef } from './SettingRef'

function body(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('SettingRef', () => {
  it('shows loading then the default for a missing value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(body([])))
    render(<SettingsProvider apiBaseUrl="http://api.test"><SettingRef settingKey="detail_crawl.batch_size" /></SettingsProvider>)
    expect(screen.getByText('Loading setting…')).toBeDefined()
    const link = await screen.findByRole('link', { name: /detail_crawl.batch_size: 50/ })
    expect(link.getAttribute('href')).toBe('/ops/settings/detail_crawl.batch_size')
    expect(screen.getByText('(default)')).toBeDefined()
  })

  it('marks the default as unavailable outside a provider', () => {
    render(<SettingRef settingKey="detail_crawl.batch_size" />)
    expect(screen.getByText('(default; settings unavailable)')).toBeDefined()
    expect(screen.getByRole('link').getAttribute('aria-label')).toContain('settings unavailable')
  })

  it('shows an error when the config request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<SettingsProvider apiBaseUrl="http://api.test"><SettingRef settingKey="detail_crawl.batch_size" /></SettingsProvider>)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Setting unavailable')
  })

  it('shows a changed-from-default indicator and the setting unit accessibly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(body([{
      id: 'saved', key: 'detail_crawl.rate_limit_ms', value: 4000, type: 'number',
      createdAt: new Date().toISOString(), createdBy: null,
    }])))
    render(<SettingsProvider apiBaseUrl="http://api.test"><SettingRef settingKey="detail_crawl.rate_limit_ms" /></SettingsProvider>)

    const link = await screen.findByRole('link', { name: /detail_crawl.rate_limit_ms: 4000 ms/ })
    expect(link.textContent).toContain('4000 ms')
    expect(screen.getByText('Changed from default')).toBeDefined()
  })

  it('updates every reference after an inline save', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(body([])).mockResolvedValueOnce(body({ id: 'new', key: 'detail_crawl.batch_size', value: 400, type: 'number', createdAt: new Date().toISOString(), createdBy: null }))
    vi.stubGlobal('fetch', fetcher)
    render(<SettingsProvider apiBaseUrl="http://api.test"><SettingRef settingKey="detail_crawl.batch_size" /><SettingRef settingKey="detail_crawl.batch_size" /></SettingsProvider>)
    await screen.findAllByRole('link', { name: /detail_crawl.batch_size: 50/ })
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit detail_crawl.batch_size' })[0]!)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '400' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findAllByRole('link', { name: /detail_crawl.batch_size: 400/ })).toHaveLength(2)
  })
})
