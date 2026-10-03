import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createTestTranslator } from '@/test-utils/intl'

let requestLocale = 'en'

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'X-NEXT-INTL-LOCALE': requestLocale }),
}))
vi.mock('next/font/google', () => ({
  Plus_Jakarta_Sans: () => ({ variable: 'font-sans' }),
  Raleway: () => ({ variable: 'font-logo' }),
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
    createTestTranslator(namespace, locale === 'es' ? 'es' : 'en'),
}))

import RootLayout, { generateMetadata } from './layout'

describe('root layout document language', () => {
  it.each(['en', 'es'])('sets <html lang> to the active locale (%s)', async (locale) => {
    requestLocale = locale
    const html = (await RootLayout({ children: null })) as ReactElement<{ lang: string }>

    expect(html.type).toBe('html')
    expect(html.props.lang).toBe(locale)
  })

  it('falls back to English for unsupported locales', async () => {
    requestLocale = 'fr'
    const html = (await RootLayout({ children: null })) as ReactElement<{ lang: string }>

    expect(html.props.lang).toBe('en')
  })

  it('localizes the document title and description', async () => {
    requestLocale = 'es'
    const metadata = await generateMetadata()

    expect(metadata.title).toBe('WivWav — Encuentre vehículos accesibles para sillas de ruedas')
    expect(String(metadata.description)).toMatch(/^Busque miles de vehículos accesibles/)

    requestLocale = 'en'
    expect((await generateMetadata()).title).toBe('WivWav — Find Wheelchair Accessible Vehicles')
  })
})
