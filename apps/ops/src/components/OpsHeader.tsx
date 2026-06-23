import Link from 'next/link'
import type { ReactNode } from 'react'
import styles from './OpsHeader.module.css'

interface OpsHeaderProps {
  section?: ReactNode
}

export function OpsHeader({ section }: OpsHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/ops" className={styles.brand} aria-label="WivWav Ops — go to ops overview">
          WivWav Ops
        </Link>
        {section && (
          <>
            <span className={styles.divider} aria-hidden="true">/</span>
            <span className={styles.section}>{section}</span>
          </>
        )}
      </div>
    </header>
  )
}
