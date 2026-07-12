import { getPublicApiBaseUrl } from '@/lib/api-url'
import { StatusDashboard } from './StatusDashboard'
import { OpsShell } from '@/components/OpsShell'
import styles from './page.module.css'

export default function StatusPage() {
  return (
    <OpsShell sectionTitle="System status">
      <main id="main-content" className={styles.main}>
        <div className={styles.container}>
          <StatusDashboard apiBaseUrl={getPublicApiBaseUrl()} />
        </div>
      </main>
    </OpsShell>
  )
}
