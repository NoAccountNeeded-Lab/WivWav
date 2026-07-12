import type { ReactNode } from 'react'
import { OpsHeader } from './OpsHeader'
import styles from './OpsShell.module.css'

interface OpsShellProps {
  children: ReactNode
  sectionTitle?: string
  nav?: ReactNode
  inspector?: ReactNode
}

export function OpsShell({ children, sectionTitle, nav, inspector }: OpsShellProps) {
  return (
    <div className={styles.shell}>
      <div className={styles.headerSlot}>
        <OpsHeader {...(sectionTitle != null ? { sectionTitle } : {})} />
      </div>
      <div className={styles.navSlot}>
        {nav ?? <div aria-hidden="true" className={styles.placeholder} />}
      </div>
      <div className={styles.mainSlot}>{children}</div>
      <div className={styles.inspectorSlot}>
        {inspector ?? <div aria-hidden="true" className={styles.placeholder} />}
      </div>
    </div>
  )
}
