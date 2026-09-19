import type { Metadata } from 'next'
import { SiteHeader } from '@/components/SiteHeader'
import styles from '@/styles/legal-page.module.css'

const CRAWLER_USER_AGENT = 'WivWav/1.0 (+https://wivwav.com/bot)'
const ROBOTS_BLOCK_SNIPPET = 'User-agent: WivWav\nDisallow: /'

export const metadata: Metadata = {
  title: 'WivWav Crawler Info — For Site Owners',
  description: 'How the WivWav crawler identifies itself, what it collects, and how to control or block it.',
}

export default function BotInfoPage() {
  return (
    <>
      <SiteHeader section="Crawler Info" />
      <div className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.heading}>WivWav Crawler Info</h1>
          <p className={styles.updated}>Last updated: September 2026</p>

          <section className={styles.section} aria-labelledby="what-heading">
            <h2 id="what-heading" className={styles.sectionHeading}>What is WivWav?</h2>
            <p className={styles.body}>
              WivWav is a free search index for wheelchair accessible vehicles (WAVs). Our crawler
              visits publicly accessible listing pages across many independent websites and lets
              people search across all of them in one place, the way a general search engine indexes
              pages from across the web.
            </p>
          </section>

          <section className={styles.section} aria-labelledby="ua-heading">
            <h2 id="ua-heading" className={styles.sectionHeading}>Our user-agent</h2>
            <p className={styles.body}>
              Our crawler identifies itself with the following user-agent string:
            </p>
            <pre className={styles.code}>{CRAWLER_USER_AGENT}</pre>
            <p className={styles.body}>
              You can match this string in your server logs to identify our traffic. If this string
              ever changes, we will update it on this page first.
            </p>
          </section>

          <section className={styles.section} aria-labelledby="data-heading">
            <h2 id="data-heading" className={styles.sectionHeading}>What we collect</h2>
            <p className={styles.body}>
              From each listing page we crawl, we collect publicly visible vehicle listing details —
              things like price, mileage, location, vehicle facts (make, model, year), and the
              listing&apos;s photos and description as published on the page. We do not create an
              account, log in, or access anything that isn&apos;t already visible to any visitor.
            </p>
          </section>

          <section className={styles.section} aria-labelledby="use-heading">
            <h2 id="use-heading" className={styles.sectionHeading}>What we do with it</h2>
            <p className={styles.body}>
              Collected details are indexed for search and shown to WivWav users as summarized facts
              and short snippets in search results. Every listing we show links back to the original
              page on your site — WivWav is a discovery layer that sends visitors to you, not a
              destination that replaces a visit to your site.
            </p>
          </section>

          <section className={styles.section} aria-labelledby="robots-heading">
            <h2 id="robots-heading" className={styles.sectionHeading}>robots.txt compliance</h2>
            <p className={styles.body}>
              Our crawler checks <code>robots.txt</code> before requesting any page on your site and
              honors every <code>Disallow</code> rule that applies to it, including rules written
              specifically for our bot by name (see below). A missing or unreadable
              <code> robots.txt</code> is treated as fully open, never as a reason to skip the check.
            </p>
          </section>

          <section className={styles.section} aria-labelledby="rate-heading">
            <h2 id="rate-heading" className={styles.sectionHeading}>Crawl rate</h2>
            <p className={styles.body}>
              We pace our requests conservatively and add randomized delays between them, so our
              crawler never bursts a large volume of traffic at one site. We also honor a
              site&apos;s explicitly declared <code>Crawl-delay</code> directive where one is set.
            </p>
          </section>

          <section className={styles.section} aria-labelledby="block-heading">
            <h2 id="block-heading" className={styles.sectionHeading}>How to block just WivWav</h2>
            <p className={styles.body}>
              If you&apos;d like to exclude only our crawler without affecting search engines or other
              bots, add a block targeting our user-agent name to your <code>robots.txt</code>:
            </p>
            <pre className={styles.code}>{ROBOTS_BLOCK_SNIPPET}</pre>
            <p className={styles.body}>
              We check for this on every crawl and will stop requesting your site once it&apos;s in
              place. You can also scope the block to specific paths instead of your whole site by
              listing them under <code>Disallow</code> individually.
            </p>
          </section>

          <section className={styles.section} aria-labelledby="no-circumvention-heading">
            <h2 id="no-circumvention-heading" className={styles.sectionHeading}>What we never do</h2>
            <p className={styles.body}>
              Our crawler never logs in, creates an account, or agrees to any terms of service to
              access a page. If a site blocks us — through <code>robots.txt</code>, an IP block, a
              CAPTCHA, or any other access control — we stop and do not attempt to get around it.
            </p>
          </section>

          <section className={styles.section} aria-labelledby="monetization-heading">
            <h2 id="monetization-heading" className={styles.sectionHeading}>How WivWav is funded</h2>
            <p className={styles.body}>
              WivWav is currently free to use, with no ads. If hosting and infrastructure costs ever
              require it as the service grows, we may introduce minimal, non-intrusive advertising to
              cover those costs — not as a business model built around competing with the sites we
              index.
            </p>
          </section>

          <aside className={styles.contact} aria-labelledby="bot-contact-heading">
            <h2 id="bot-contact-heading" className={styles.contactHeading}>Questions, removal, or reporting an issue</h2>
            <p className={styles.contactBody}>
              If you&apos;d like us to stop crawling your site, correct something, or you have any
              other question about our crawler, email{' '}
              <a href="mailto:privacy@wivwav.com" className={styles.contactLink}>
                privacy@wivwav.com
              </a>
              {' '}with your site&apos;s URL. We will respond and comply promptly.
            </p>
          </aside>
        </div>
      </div>
    </>
  )
}
