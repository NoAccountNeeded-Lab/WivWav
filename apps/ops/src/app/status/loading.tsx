import { OpsShell } from '@/components/OpsShell'
import styles from './page.module.css'

const SERVICE_NAMES = ['Web', 'API', 'PostgreSQL', 'Meilisearch', 'Valkey', 'Scraper', 'Ollama']

/**
 * Route-level Suspense fallback for `/status` (E5, issue #732). Renders the
 * same fixed 7-row service list `StatusDashboard` always renders (its rows
 * never change in count, only status) so there is no layout shift once the
 * client component mounts and starts filling in real statuses.
 */
export default function StatusLoading() {
  return (
    <OpsShell section="System Status">
      <main id="main-content" className={styles.main}>
        <div className={styles.container}>
          <section className={styles.statusPanel} aria-hidden="true">
            <div className={styles.summary}>
              <div>
                <h1 className={styles.heading}>System status</h1>
                <p className={styles.summaryText}>Checking status...</p>
              </div>
              <div className={styles.actions}>
                <p className={styles.updatedAt}>Checking status...</p>
                <button className={styles.refreshButton} type="button" disabled>Refresh</button>
              </div>
            </div>
            <div className={styles.statusList}>
              {SERVICE_NAMES.map(name => (
                <div className={styles.statusRow} key={name}>
                  <div className={styles.serviceNameGroup}>
                    <span className={styles.indicator} />
                    <span className={styles.serviceName}>{name}</span>
                  </div>
                  <span className={styles.statusLabel}>UNKNOWN</span>
                  <span className={styles.detailText}>Waiting for API data</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </OpsShell>
  )
}
