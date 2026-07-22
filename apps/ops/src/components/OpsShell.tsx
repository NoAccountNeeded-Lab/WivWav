import type { ReactNode } from 'react'
import { OpsHeader } from './OpsHeader'
import { OPS_INSPECTOR_SLOT_ID } from './Inspector/inspector-slot'
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
      <div id={OPS_INSPECTOR_SLOT_ID} className={styles.inspectorSlot}>
        {inspector ?? <div aria-hidden="true" className={styles.placeholder} />}
      </div>
    </div>
  )
}
