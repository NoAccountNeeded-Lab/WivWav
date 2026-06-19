import Link from 'next/link'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { OPS_NAV_GROUPS, type OpsNavItem } from './ops-nav'
import styles from './page.module.css'

export default function OpsPage() {
  const apiBaseUrl = getPublicApiBaseUrl()

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.heading}>Operations</h1>
        <p className={styles.subheading}>
          Operator tasks are grouped by intent. Start with daily health, then drill into sources,
          workflows, failures, schedules, logs, or advanced diagnostics.
        </p>
        <nav className={styles.groupList} aria-label="Operations task groups">
          {OPS_NAV_GROUPS.map(group => (
            <section key={group.id} className={styles.group} aria-labelledby={`ops-${group.id}`}>
              <div className={styles.groupHeader}>
                <h2 id={`ops-${group.id}`} className={styles.groupTitle}>{group.title}</h2>
                <p className={styles.groupIntro}>{group.intro}</p>
              </div>
              <div className={styles.cardGrid}>
                {group.items.map(item => (
                  <OpsNavCard key={`${group.id}-${item.href}-${item.title}`} item={item} apiBaseUrl={apiBaseUrl} />
                ))}
              </div>
            </section>
          ))}
        </nav>
      </div>
    </main>
  )
}

function OpsNavCard({ item, apiBaseUrl }: { item: OpsNavItem; apiBaseUrl: string }) {
  const href = item.href === '/admin/board' ? `${apiBaseUrl}/admin/board` : item.href

  if (item.external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.card}
        aria-label={`${item.title}: ${item.desc} Opens in a new tab.`}
      >
        <h3 className={styles.cardTitle}>{item.title} <span className={styles.cardArrow} aria-hidden="true">↗</span></h3>
        <p className={styles.cardDesc}>{item.desc}</p>
      </a>
    )
  }

  return (
    <Link href={href} className={styles.card} aria-label={`${item.title}: ${item.desc}`}>
      <h3 className={styles.cardTitle}>{item.title} <span className={styles.cardArrow} aria-hidden="true">→</span></h3>
      <p className={styles.cardDesc}>{item.desc}</p>
    </Link>
  )
}
