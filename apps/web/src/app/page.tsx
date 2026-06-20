import { IntakeForm } from '../components/IntakeForm'
import { SiteHeader } from '../components/SiteHeader'
import styles from './page.module.css'

export default function HomePage() {
  return (
    <>
      <SiteHeader />

      <main id="main-content" tabIndex={-1} className={styles.main}>
        <div className={styles.container}>

          <section className={styles.heroSection} aria-labelledby="hero-heading">
            <IntakeForm />
          </section>

        </div>
      </main>
    </>
  )
}
