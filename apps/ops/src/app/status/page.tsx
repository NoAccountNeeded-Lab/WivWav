import { getPublicApiBaseUrl } from '@/lib/api-url'
import { StatusDashboard } from './StatusDashboard'
import { OpsHeader } from '@/components/OpsHeader'
import styles from './page.module.css'

export default function StatusPage() {
  return (
    <>
      <OpsHeader section="System Status" />

      <main id="main-content" className={styles.main}>
        <div className={styles.container}>
          <StatusDashboard apiBaseUrl={getPublicApiBaseUrl()} />
        </div>
      </main>
    </>
  )
}
