import type { ReactNode } from 'react'
import type { HelmSection } from './helm-url'
import { sectionElementId } from './HelmNav'
import styles from './helm-sections.module.css'

/** One section of the shared overview. The heading is focusable so section navigation can move focus to it. */
export function SectionFrame({ section, title, current, children }: { section: HelmSection; title: string; current: boolean; children: ReactNode }) {
  const headingId = sectionElementId(section)
  return (
    <section className={styles.section} aria-labelledby={headingId} data-current={current ? 'true' : undefined}>
      <div className={styles.sectionHeader}>
        <h2 id={headingId} tabIndex={-1}>{title}</h2>
      </div>
      {children}
    </section>
  )
}
