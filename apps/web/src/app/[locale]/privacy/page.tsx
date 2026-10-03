import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { SiteHeader } from '@/components/SiteHeader'
import styles from '@/styles/legal-page.module.css'

interface PageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'PrivacyPage' })
  return { title: t('metaTitle'), description: t('metaDescription') }
}

export default async function PrivacyPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'PrivacyPage' })
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

          <section className={styles.section} aria-labelledby="overview-heading">
            <h2 id="overview-heading" className={styles.sectionHeading}>{t('overview.heading')}</h2>
            <p className={styles.body}>{t.rich('overview.p1', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="data-collected-heading">
            <h2 id="data-collected-heading" className={styles.sectionHeading}>{t('collected.heading')}</h2>
            <p className={styles.body}>{t.rich('collected.p1', rich)}</p>
            <p className={styles.body}>{t.rich('collected.p2', rich)}</p>
            <ul className={styles.list}>
              <li>{t.rich('collected.list3.i1', rich)}</li>
              <li>{t.rich('collected.list3.i2', rich)}</li>
              <li>{t.rich('collected.list3.i3', rich)}</li>
              <li>{t.rich('collected.list3.i4', rich)}</li>
            </ul>
            <p className={styles.body}>{t.rich('collected.p4', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="cookies-heading">
            <h2 id="cookies-heading" className={styles.sectionHeading}>{t('cookies.heading')}</h2>
            <p className={styles.body}>{t.rich('cookies.p1', rich)}</p>
            <p className={styles.body}>{t.rich('cookies.p2', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="third-party-heading">
            <h2 id="third-party-heading" className={styles.sectionHeading}>{t('thirdParty.heading')}</h2>
            <p className={styles.body}>{t.rich('thirdParty.p1', rich)}</p>
            <p className={styles.body}>{t.rich('thirdParty.p2', rich)}</p>
            <p className={styles.body}>{t.rich('thirdParty.p3', rich)}</p>
            <p className={styles.body}>{t.rich('thirdParty.p4', rich)}</p>
            <p className={styles.body}>{t.rich('thirdParty.p5', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="analytics-heading">
            <h2 id="analytics-heading" className={styles.sectionHeading}>{t('analytics.heading')}</h2>
            <p className={styles.body}>{t.rich('analytics.p1', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="children-heading">
            <h2 id="children-heading" className={styles.sectionHeading}>{t('children.heading')}</h2>
            <p className={styles.body}>{t.rich('children.p1', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="changes-heading">
            <h2 id="changes-heading" className={styles.sectionHeading}>{t('changes.heading')}</h2>
            <p className={styles.body}>{t.rich('changes.p1', rich)}</p>
          </section>

          <aside className={styles.contact} aria-labelledby="privacy-contact-heading">
            <h2 id="privacy-contact-heading" className={styles.contactHeading}>{t('contact.heading')}</h2>
            <p className={styles.contactBody}>{t.rich('contact.body', rich)}</p>
          </aside>
        </div>
      </div>
    </>
  )
}
