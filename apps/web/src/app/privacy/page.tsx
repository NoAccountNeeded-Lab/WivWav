import type { Metadata } from 'next'
import { SiteHeader } from '@/components/SiteHeader'
import styles from '@/styles/legal-page.module.css'

export const metadata: Metadata = {
  title: 'Privacy Policy — WivWav',
  description: 'How WivWav handles data from site visitors and third-party sources.',
}

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader section="Privacy Policy" />
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.heading}>Privacy Policy</h1>
        <p className={styles.updated}>Last updated: June 2026</p>

        <section className={styles.section} aria-labelledby="overview-heading">
          <h2 id="overview-heading" className={styles.sectionHeading}>Overview</h2>
          <p className={styles.body}>
            WivWav is a free, open-access search tool for wheelchair accessible vehicles. No account
            or login is required to use the site. This policy explains what information is collected,
            how it is used, and your rights as a visitor.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="data-collected-heading">
          <h2 id="data-collected-heading" className={styles.sectionHeading}>Data Collected from Visitors</h2>
          <p className={styles.body}>
            WivWav does not require registration or login. We do not knowingly collect personally
            identifiable information (PII) such as your name, email address, or phone number.
          </p>
          <p className={styles.body}>
            Standard web server and hosting infrastructure may automatically record the following for
            operational and security purposes:
          </p>
          <ul className={styles.list}>
            <li>IP address (anonymized or truncated where feasible)</li>
            <li>Browser type and operating system</li>
            <li>Pages visited and timestamps</li>
            <li>Referring URL</li>
          </ul>
          <p className={styles.body}>
            This information is used solely to operate and improve the service and is not sold or shared
            with advertising networks.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="cookies-heading">
          <h2 id="cookies-heading" className={styles.sectionHeading}>Cookies and Local Storage</h2>
          <p className={styles.body}>
            WivWav uses browser <code>localStorage</code> to remember your optional theme preference
            (Spring, Summer, Fall, or Winter). This data never leaves your device and is not transmitted
            to our servers.
          </p>
          <p className={styles.body}>
            We do not use tracking cookies or third-party advertising cookies. Any session cookies set by
            infrastructure providers are used only to maintain operational security and are not used for
            cross-site tracking.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="third-party-heading">
          <h2 id="third-party-heading" className={styles.sectionHeading}>Third-Party Data Sources</h2>
          <p className={styles.body}>
            Listing data on WivWav is sourced from publicly accessible dealer websites and the
            U.S. National Highway Traffic Safety Administration (NHTSA) public API. We aggregate and
            index this information to make it searchable. We do not control the privacy practices of
            those sources.
          </p>
          <p className={styles.body}>
            We do not share visitor data with dealers or any third party for marketing purposes.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="analytics-heading">
          <h2 id="analytics-heading" className={styles.sectionHeading}>Analytics</h2>
          <p className={styles.body}>
            If analytics are in use, they are configured to minimize data collection — for example,
            with IP anonymization and no cross-site tracking. This policy will be updated to name any
            analytics provider before it is activated.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="children-heading">
          <h2 id="children-heading" className={styles.sectionHeading}>Children&apos;s Privacy</h2>
          <p className={styles.body}>
            WivWav is not directed at children under 13. We do not knowingly collect personal
            information from children.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="changes-heading">
          <h2 id="changes-heading" className={styles.sectionHeading}>Changes to This Policy</h2>
          <p className={styles.body}>
            We may update this Privacy Policy from time to time. The &ldquo;Last updated&rdquo; date at
            the top of this page reflects the most recent revision. Continued use of the site after
            changes constitutes acceptance of the updated policy.
          </p>
        </section>

        <aside className={styles.contact} aria-labelledby="privacy-contact-heading">
          <h2 id="privacy-contact-heading" className={styles.contactHeading}>Contact</h2>
          <p className={styles.contactBody}>
            Questions about this Privacy Policy? Email{' '}
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
