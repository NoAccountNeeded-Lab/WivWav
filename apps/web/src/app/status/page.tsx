import Link from 'next/link'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { StatusDashboard } from './StatusDashboard'
import { SiteHeader } from '@/components/SiteHeader'
import styles from './page.module.css'

export default function StatusPage() {
  return (
    <>
      <SiteHeader section="System Status" />

      <main id="main-content" className={styles.main}>
        <div className={styles.container}>
          <StatusDashboard apiBaseUrl={getPublicApiBaseUrl()} />
        </div>
      </main>
    </>
  )
}
