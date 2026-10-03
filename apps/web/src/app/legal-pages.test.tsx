// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestTranslator } from '@/test-utils/intl'

vi.mock('next-intl/server', () => ({
  setRequestLocale: () => {},
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
    createTestTranslator(namespace, locale === 'es' ? 'es' : 'en'),
}))
vi.mock('@/components/SiteHeader', () => ({
  SiteHeader: ({ section }: { section: string }) => <header>{section}</header>,
}))

import BotInfoPage from './[locale]/bot/page'
import PrivacyPage from './[locale]/privacy/page'
import TermsPage from './[locale]/terms/page'

afterEach(() => cleanup())

async function renderPage(
  Page: (props: { params: Promise<{ locale: string }> }) => Promise<React.ReactElement>,
  locale: string,
) {
  render(await Page({ params: Promise.resolve({ locale }) }))
}

describe('legal pages render rich text in both locales', () => {
  it('renders the privacy policy in English and Spanish with its mailto link', async () => {
    await renderPage(PrivacyPage, 'en')
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeTruthy()
    expect(document.querySelector('a[href="mailto:privacy@wivwav.com"]')).toBeTruthy()
    cleanup()

    await renderPage(PrivacyPage, 'es')
    expect(screen.getByRole('heading', { level: 1, name: 'Política de privacidad' })).toBeTruthy()
    expect(document.querySelector('code')?.textContent).toBe('localStorage')
    expect(document.querySelector('a[href="mailto:privacy@wivwav.com"]')).toBeTruthy()
  })

  it('renders the terms of service in Spanish with emphasis markup', async () => {
    await renderPage(TermsPage, 'es')
    expect(screen.getByRole('heading', { level: 1, name: 'Términos de servicio' })).toBeTruthy()
    expect(document.querySelector('strong')?.textContent).toBe('únicamente con fines informativos')
    expect(document.querySelector('a[href="mailto:legal@wivwav.com"]')).toBeTruthy()
  })

  it('renders the crawler page in Spanish with inline code', async () => {
    await renderPage(BotInfoPage, 'es')
    expect(screen.getByRole('heading', { level: 1, name: 'Información sobre el rastreador de WivWav' })).toBeTruthy()
    expect(document.querySelectorAll('code').length).toBeGreaterThan(3)
    expect(screen.queryByText('What is WivWav?')).toBeNull()
  })
})
