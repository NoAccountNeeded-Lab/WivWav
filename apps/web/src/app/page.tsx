import { IntakeForm } from '../components/IntakeForm'
import { SiteHeader } from '../components/SiteHeader'
import styles from './page.module.css'

export default function HomePage() {
  return (
    <>
      <SiteHeader section="Wheelchair Accessible Vehicles" />

      <main id="main-content" tabIndex={-1} className={styles.main}>
        <div className={styles.container}>

          <section className={styles.heroSection} aria-labelledby="hero-heading">
            <h1 id="hero-heading" className={styles.heroHeading}>
              Find the right wheelchair accessible vehicle
            </h1>
            <p className={styles.heroLead}>
              Describe what you need in plain language — we&apos;ll set the filters for you. Or skip
              straight to the search.
            </p>

            <div className={styles.intakeCard}>
              <IntakeForm />
            </div>
          </section>

        </div>
      </main>
    </>
  )
}
