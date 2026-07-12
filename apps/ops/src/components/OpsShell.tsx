import type { ReactNode } from 'react'
import { OpsHeader } from './OpsHeader'
import styles from './OpsShell.module.css'

interface OpsShellProps {
  children: ReactNode
  section?: ReactNode
  nav?: ReactNode
  inspector?: ReactNode
}

export function OpsShell({ children, section, nav, inspector }: OpsShellProps) {
  return (
    <div className={styles.shell}>
      <div className={styles.headerSlot}>
        <OpsHeader section={section} />
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
