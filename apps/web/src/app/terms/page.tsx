import type { Metadata } from 'next'
import styles from '@/styles/legal-page.module.css'

export const metadata: Metadata = {
  title: 'Terms of Service — WivWav',
  description: 'Terms governing your use of WivWav, an informational tool for finding wheelchair accessible vehicles.',
}

export default function TermsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.heading}>Terms of Service</h1>
        <p className={styles.updated}>Last updated: June 2026</p>

        <section className={styles.section} aria-labelledby="acceptance-heading">
          <h2 id="acceptance-heading" className={styles.sectionHeading}>Acceptance of Terms</h2>
          <p className={styles.body}>
            By using WivWav (&ldquo;the Service&rdquo;), you agree to these Terms of Service. If you
            do not agree, please do not use the Service.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="informational-heading">
          <h2 id="informational-heading" className={styles.sectionHeading}>Informational Use Only</h2>
          <p className={styles.body}>
            WivWav is provided for <strong>informational purposes only</strong>. The Service
            aggregates publicly available vehicle listings from dealer websites and public data sources.
            Nothing on this site constitutes:
          </p>
          <ul className={styles.list}>
            <li>A professional recommendation, endorsement, or professional advice of any kind</li>
            <li>A guarantee of vehicle availability, condition, pricing, or fitness for a specific purpose</li>
            <li>A representation that any listing is complete, accurate, or current</li>
          </ul>
          <p className={styles.body}>
            Always verify vehicle details, accessibility features, and pricing directly with the dealer
            or seller before making any purchase decision.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="accuracy-heading">
          <h2 id="accuracy-heading" className={styles.sectionHeading}>Data Accuracy Limitations</h2>
          <p className={styles.body}>
            Listing data is sourced automatically from third-party dealer sites and the NHTSA public API.
            WivWav does not independently verify listing details. Data may be:
          </p>
          <ul className={styles.list}>
            <li>Out of date — vehicles may have sold or changed in price</li>
            <li>Incomplete — not all accessibility features may be captured</li>
            <li>Inaccurate — scraping and automated processing can introduce errors</li>
          </ul>
          <p className={styles.body}>
            WivWav makes no warranties, express or implied, about the accuracy, completeness, or
            timeliness of any information presented on the site.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="no-warranty-heading">
          <h2 id="no-warranty-heading" className={styles.sectionHeading}>No Warranty</h2>
          <p className={styles.body}>
            The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranty
            of any kind. To the fullest extent permitted by law, WivWav disclaims all warranties,
            including implied warranties of merchantability, fitness for a particular purpose, and
            non-infringement.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="liability-heading">
          <h2 id="liability-heading" className={styles.sectionHeading}>Limitation of Liability</h2>
          <p className={styles.body}>
            To the maximum extent permitted by applicable law, WivWav and its operators shall not be
            liable for any indirect, incidental, special, consequential, or punitive damages arising
            from your use of, or inability to use, the Service or any information obtained through it.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="use-heading">
          <h2 id="use-heading" className={styles.sectionHeading}>Permitted Use</h2>
          <p className={styles.body}>
            You may use the Service for personal, non-commercial research into wheelchair accessible
            vehicles. You may not:
          </p>
          <ul className={styles.list}>
            <li>Scrape or bulk-download content from the site in ways that disrupt the Service</li>
            <li>Use the Service to build a competing aggregation product without permission</li>
            <li>Attempt to circumvent any security measures</li>
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="third-party-heading">
          <h2 id="third-party-heading" className={styles.sectionHeading}>Third-Party Links</h2>
          <p className={styles.body}>
            The Service links to dealer websites and external data sources. We are not responsible for
            the content, accuracy, or privacy practices of those third-party sites. Visiting them is
            subject to their own terms and policies.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="changes-heading">
          <h2 id="changes-heading" className={styles.sectionHeading}>Changes to These Terms</h2>
          <p className={styles.body}>
            We may update these Terms at any time. The &ldquo;Last updated&rdquo; date reflects the most
            recent revision. Continued use of the Service after changes constitutes acceptance of the
            updated Terms.
          </p>
        </section>

        <aside className={styles.contact} aria-labelledby="terms-contact-heading">
          <h2 id="terms-contact-heading" className={styles.contactHeading}>Contact</h2>
          <p className={styles.contactBody}>
            Questions about these Terms? Email{' '}
            <a href="mailto:legal@wivwav.com" className={styles.contactLink}>
              legal@wivwav.com
            </a>
            .
          </p>
        </aside>
      </div>
    </div>
  )
}
