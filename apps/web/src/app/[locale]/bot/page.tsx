import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { SiteHeader } from '@/components/SiteHeader'
import styles from '@/styles/legal-page.module.css'

const CRAWLER_USER_AGENT = 'WivWav/1.0 (+https://wivwav.com/bot)'
const ROBOTS_BLOCK_SNIPPET = 'User-agent: WivWav\nDisallow: /'

interface PageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'BotPage' })
  return { title: t('metaTitle'), description: t('metaDescription') }
}

export default async function BotInfoPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'BotPage' })
  const rich = {
    code: (chunks: React.ReactNode) => <code>{chunks}</code>,
    strong: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
    mail: (chunks: React.ReactNode) => (
      <a href="mailto:privacy@wivwav.com" className={styles.contactLink}>
        {chunks}
      </a>
    ),
  }

  return (
    <>
      <SiteHeader locale={locale} section={t('sectionLabel')} />
      <div className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.heading}>{t('heading')}</h1>
          <p className={styles.updated}>{t('updated')}</p>

          <section className={styles.section} aria-labelledby="what-heading">
            <h2 id="what-heading" className={styles.sectionHeading}>{t('what.heading')}</h2>
            <p className={styles.body}>{t.rich('what.p1', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="ua-heading">
            <h2 id="ua-heading" className={styles.sectionHeading}>{t('ua.heading')}</h2>
            <p className={styles.body}>{t.rich('ua.p1', rich)}</p>
            <pre className={styles.code}>{CRAWLER_USER_AGENT}</pre>
            <p className={styles.body}>{t.rich('ua.p3', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="data-heading">
            <h2 id="data-heading" className={styles.sectionHeading}>{t('data.heading')}</h2>
            <p className={styles.body}>{t.rich('data.p1', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="use-heading">
            <h2 id="use-heading" className={styles.sectionHeading}>{t('use.heading')}</h2>
            <p className={styles.body}>{t.rich('use.p1', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="robots-heading">
            <h2 id="robots-heading" className={styles.sectionHeading}>{t('robots.heading')}</h2>
            <p className={styles.body}>{t.rich('robots.p1', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="rate-heading">
            <h2 id="rate-heading" className={styles.sectionHeading}>{t('rate.heading')}</h2>
            <p className={styles.body}>{t.rich('rate.p1', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="block-heading">
            <h2 id="block-heading" className={styles.sectionHeading}>{t('block.heading')}</h2>
            <p className={styles.body}>{t.rich('block.p1', rich)}</p>
            <pre className={styles.code}>{ROBOTS_BLOCK_SNIPPET}</pre>
            <p className={styles.body}>{t.rich('block.p3', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="no-circumvention-heading">
            <h2 id="no-circumvention-heading" className={styles.sectionHeading}>{t('noCircumvention.heading')}</h2>
            <p className={styles.body}>{t.rich('noCircumvention.p1', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="monetization-heading">
            <h2 id="monetization-heading" className={styles.sectionHeading}>{t('funding.heading')}</h2>
            <p className={styles.body}>{t.rich('funding.p1', rich)}</p>
          </section>

          <aside className={styles.contact} aria-labelledby="bot-contact-heading">
            <h2 id="bot-contact-heading" className={styles.contactHeading}>{t('contact.heading')}</h2>
            <p className={styles.contactBody}>{t.rich('contact.body', rich)}</p>
          </aside>
        </div>
      </div>
    </>
  )
}
