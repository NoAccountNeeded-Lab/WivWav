import type { Metadata } from 'next'
import { SiteHeader } from '@/components/SiteHeader'
import styles from '@/styles/legal-page.module.css'

const CRAWLER_USER_AGENT = 'WivWav/1.0 (+https://wivwav.com/bot)'

export const metadata: Metadata = {
  title: 'WivWav Crawler — WivWav',
  description: 'How WivWav identifies and paces its vehicle listing crawler.',
}

export default function BotPage() {
  return (
    <>
      <SiteHeader section="Crawler" />
      <div className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.heading}>WivWav Crawler</h1>
          <p className={styles.updated}>Last updated: September 2026</p>

          <section className={styles.section} aria-labelledby="identity-heading">
            <h2 id="identity-heading" className={styles.sectionHeading}>Crawler Identity</h2>
            <p className={styles.body}>
              WivWav uses an automated crawler to check publicly accessible wheelchair accessible
              vehicle listings and keep source-attributed search results current.
            </p>
            <p className={styles.body}>
              Crawlee-managed requests identify themselves with this user-agent:
            </p>
            <p className={styles.body}>
              <code>{CRAWLER_USER_AGENT}</code>
            </p>
          </section>

          <section className={styles.section} aria-labelledby="etiquette-heading">
            <h2 id="etiquette-heading" className={styles.sectionHeading}>Crawl Etiquette</h2>
            <p className={styles.body}>
              Crawlee-managed requests check robots.txt with the WivWav user-agent, skip disallowed
              URLs, and apply a site&apos;s declared crawl-delay to same-domain request pacing.
            </p>
            <p className={styles.body}>
              WivWav does not use crawler user-agent spoofing for Crawlee-managed requests.
            </p>
          </section>

          <section className={styles.section} aria-labelledby="data-heading">
            <h2 id="data-heading" className={styles.sectionHeading}>Data Use</h2>
            <p className={styles.body}>
              WivWav indexes source-attributed vehicle facts, listing links, location details, and
              publicly available listing images so shoppers can find wheelchair accessible vehicles.
            </p>
            <p className={styles.body}>
              WivWav does not require visitor accounts, does not crawl account-only inventory, and
              does not use the crawler to bypass login walls or access controls.
            </p>
          </section>

          <section className={styles.section} aria-labelledby="block-heading">
            <h2 id="block-heading" className={styles.sectionHeading}>Block WivWav</h2>
            <p className={styles.body}>
              Site operators can block Crawlee-managed WivWav requests with robots.txt:
            </p>
            <pre className={styles.body}>
              <code>{`User-agent: WivWav
Disallow: /`}</code>
            </pre>
            <p className={styles.body}>
              To slow requests instead of blocking them, add a crawl-delay rule for the WivWav
              user-agent.
            </p>
          </section>

          <aside className={styles.contact} aria-labelledby="bot-contact-heading">
            <h2 id="bot-contact-heading" className={styles.contactHeading}>Contact</h2>
            <p className={styles.contactBody}>
              Questions or crawl concerns? Email{' '}
              <a href="mailto:privacy@wivwav.com" className={styles.contactLink}>
                privacy@wivwav.com
              </a>
              .
            </p>
          </aside>
        </div>
      </div>
    </>
  )
}
