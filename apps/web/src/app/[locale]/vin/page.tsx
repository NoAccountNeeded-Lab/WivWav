import type { Metadata } from 'next'
import { ChevronLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { VinSearchForm } from './VinSearchForm'
import styles from './page.module.css'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'VinLookup' })
  return { title: t('metaTitle'), description: t('metaDescription') }
}

export default async function VinLookupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'VinLookup' })

  return (
    <main id="main-content" className={styles.page}>
      <Link href="/filters" className={styles.back}>
        <ChevronLeft size={16} aria-hidden />
        {t('back')}
      </Link>

      <header className={styles.header}>
        <p className={styles.eyebrow}>{t('eyebrow')}</p>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.lede}>{t('lede')}</p>
        <VinSearchForm />
      </header>

      <section className={styles.section} aria-labelledby="vin-help-heading">
        <h2 className={styles.sectionTitle} id="vin-help-heading">{t('helpHeading')}</h2>
        <div className={styles.notice}>
          <strong>{t('noticeStrong')}</strong> {t('notice')}
        </div>
      </section>
    </main>
  )
}
