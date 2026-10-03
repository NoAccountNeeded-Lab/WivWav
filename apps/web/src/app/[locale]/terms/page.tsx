import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { SiteHeader } from '@/components/SiteHeader'
import styles from '@/styles/legal-page.module.css'

interface PageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'TermsPage' })
  return { title: t('metaTitle'), description: t('metaDescription') }
}

export default async function TermsPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'TermsPage' })
  const rich = {
    code: (chunks: React.ReactNode) => <code>{chunks}</code>,
    strong: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
    mail: (chunks: React.ReactNode) => (
      <a href="mailto:legal@wivwav.com" className={styles.contactLink}>
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

          <section className={styles.section} aria-labelledby="acceptance-heading">
            <h2 id="acceptance-heading" className={styles.sectionHeading}>{t('acceptance.heading')}</h2>
            <p className={styles.body}>{t.rich('acceptance.p1', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="informational-heading">
            <h2 id="informational-heading" className={styles.sectionHeading}>{t('informational.heading')}</h2>
            <p className={styles.body}>{t.rich('informational.p1', rich)}</p>
            <ul className={styles.list}>
              <li>{t.rich('informational.list2.i1', rich)}</li>
              <li>{t.rich('informational.list2.i2', rich)}</li>
              <li>{t.rich('informational.list2.i3', rich)}</li>
            </ul>
            <p className={styles.body}>{t.rich('informational.p3', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="accuracy-heading">
            <h2 id="accuracy-heading" className={styles.sectionHeading}>{t('accuracy.heading')}</h2>
            <p className={styles.body}>{t.rich('accuracy.p1', rich)}</p>
            <ul className={styles.list}>
              <li>{t.rich('accuracy.list2.i1', rich)}</li>
              <li>{t.rich('accuracy.list2.i2', rich)}</li>
              <li>{t.rich('accuracy.list2.i3', rich)}</li>
            </ul>
            <p className={styles.body}>{t.rich('accuracy.p3', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="no-warranty-heading">
            <h2 id="no-warranty-heading" className={styles.sectionHeading}>{t('warranty.heading')}</h2>
            <p className={styles.body}>{t.rich('warranty.p1', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="liability-heading">
            <h2 id="liability-heading" className={styles.sectionHeading}>{t('liability.heading')}</h2>
            <p className={styles.body}>{t.rich('liability.p1', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="use-heading">
            <h2 id="use-heading" className={styles.sectionHeading}>{t('use.heading')}</h2>
            <p className={styles.body}>{t.rich('use.p1', rich)}</p>
            <ul className={styles.list}>
              <li>{t.rich('use.list2.i1', rich)}</li>
              <li>{t.rich('use.list2.i2', rich)}</li>
              <li>{t.rich('use.list2.i3', rich)}</li>
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="third-party-heading">
            <h2 id="third-party-heading" className={styles.sectionHeading}>{t('thirdParty.heading')}</h2>
            <p className={styles.body}>{t.rich('thirdParty.p1', rich)}</p>
          </section>

          <section className={styles.section} aria-labelledby="changes-heading">
            <h2 id="changes-heading" className={styles.sectionHeading}>{t('changes.heading')}</h2>
            <p className={styles.body}>{t.rich('changes.p1', rich)}</p>
          </section>

          <aside className={styles.contact} aria-labelledby="terms-contact-heading">
            <h2 id="terms-contact-heading" className={styles.contactHeading}>{t('contact.heading')}</h2>
            <p className={styles.contactBody}>{t.rich('contact.body', rich)}</p>
          </aside>
        </div>
      </div>
    </>
  )
}
