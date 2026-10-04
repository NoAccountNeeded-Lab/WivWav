'use client'

import { Activity, GitBranch, LayoutDashboard, Package, TriangleAlert } from 'lucide-react'
import { HELM_SECTIONS, type HelmSection } from './helm-url'
import { useHelm } from './helm-context'
import styles from './helm-shell.module.css'

const SECTION_META: Record<HelmSection, { label: string; Icon: typeof Activity }> = {
  overview: { label: 'Overview', Icon: LayoutDashboard },
  inventory: { label: 'Inventory', Icon: Package },
  flow: { label: 'Flow', Icon: GitBranch },
  problems: { label: 'Problems', Icon: TriangleAlert },
  activity: { label: 'Activity', Icon: Activity },
}

export function sectionElementId(section: HelmSection): string {
  return `helm-section-${section}`
}

/**
 * Section navigation: these are not separate pages. Each button selects a
 * section of the same overview (URL `?section=`), scrolls it into view and
 * moves focus to its heading.
 */
export function HelmNav() {
  const { nav } = useHelm()
  const current = nav.location.section
  return (
    <nav className={styles.nav} aria-label="Helm sections">
      <ul className={styles.navList}>
        {HELM_SECTIONS.map(section => {
          const { label, Icon } = SECTION_META[section]
          return (
            <li key={section}>
              <button
                type="button"
                className={styles.navButton}
                aria-current={current === section ? 'true' : undefined}
                onClick={() => {
                  nav.setSection(section)
                  const heading = document.getElementById(sectionElementId(section))
                  heading?.scrollIntoView?.({ block: 'start' })
                  heading?.focus({ preventScroll: true })
                }}
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
