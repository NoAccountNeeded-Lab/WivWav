// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const getHomeSnapshot = vi.hoisted(() => vi.fn())
vi.mock('@/lib/home-snapshot-server', () => ({ getHomeSnapshot }))
vi.mock('@/lib/server-api-url', () => ({ getServerApiBaseUrl: () => 'http://api.test' }))
vi.mock('@/components/SiteHeader', () => ({ SiteHeader: () => <header aria-label="Site header" /> }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('./HomeContent', () => ({
  HomeContent: ({ locale, result }: { locale: string; result: { status: string } }) => <p>{`${locale}:${result.status}`}</p>,
}))

import LocaleHomePage, { generateMetadata } from './page'

afterEach(() => cleanup())

describe('locale home page', () => {
  it('loads the snapshot from the server API and renders it in main', async () => {
    getHomeSnapshot.mockResolvedValue({ status: 'unavailable' })
    render(await LocaleHomePage({ params: Promise.resolve({ locale: 'es' }) }))
    expect(getHomeSnapshot).toHaveBeenCalledWith('http://api.test')
    expect(screen.getByRole('main').textContent).toBe('es:unavailable')
  })

  it('builds localized metadata', async () => {
    expect(await generateMetadata({ params: Promise.resolve({ locale: 'en' }) })).toEqual({ title: 'metaTitle', description: 'metaDescription' })
  })
})
