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
  })

  it('shows an error when the config request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<SettingsProvider apiBaseUrl="http://api.test"><SettingRef settingKey="detail_crawl.batch_size" /></SettingsProvider>)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Setting unavailable')
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
