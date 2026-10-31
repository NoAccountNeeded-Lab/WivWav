import { getTranslations } from 'next-intl/server'
import { SiteHeader } from '@/components/SiteHeader'
import { apiFetch } from '@/lib/api-fetch'
import { fetchHomeSnapshot } from '@/lib/home-snapshot'
import { getServerApiBaseUrl } from '@/lib/server-api-url'
import { HomeContent } from './HomeContent'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: 'HomePage' })
  return { title: t('metaTitle'), description: t('metaDescription') }
}

export default async function LocaleHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const [t, result] = await Promise.all([
    getTranslations({ locale, namespace: 'HomePage' }),
    fetchHomeSnapshot(getServerApiBaseUrl(), apiFetch),
  ])
  return (
    <>
      <SiteHeader locale={locale} section={t('sectionTitle')} />
      <main id="main-content" tabIndex={-1}>
        <HomeContent locale={locale} result={result} />
      </main>
    </>
  )
}
