'use client'

import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { RelativeTimestamp } from '@/lib/relative-time'
import { useHelm } from './helm-context'
import styles from './helm-shell.module.css'

export function HelmHeader({ environment }: { environment: string }) {
  const { data } = useHelm()
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>Helm</h1>
      <ul className={styles.headerMeta} aria-label="Workspace details">
        <li>Environment: <strong>{environment}</strong></li>
        <li>
          Updated{' '}
          {data.updatedAt ? <RelativeTimestamp value={data.updatedAt} now={new Date(data.nowMs)} /> : 'not yet'}
        </li>
      </ul>
      <span className={styles.headerSpacer} />
      <button type="button" className={styles.headerButton} onClick={data.refreshAll} disabled={data.isRefreshing}>
        <RefreshCw size={16} aria-hidden="true" />
        {data.isRefreshing ? 'Refreshing…' : 'Refresh'}
      </button>
      <Link href="/ops" className={styles.headerButton}>Legacy ops</Link>
      <span className={styles.srOnly} role="status" aria-live="polite">
        {data.isRefreshing ? 'Refreshing data' : data.updatedAt ? 'Data up to date as of last refresh' : ''}
      </span>
    </header>
  )
}
