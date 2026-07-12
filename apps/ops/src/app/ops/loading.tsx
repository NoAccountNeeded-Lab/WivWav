import { SkeletonCard, SkeletonChartBox, SkeletonListRow } from '@/components/Skeleton'
import styles from './page.module.css'

/**
 * Route-level Suspense fallback for `/ops` (E5, issue #732). Mirrors the
 * hero + bento-grid shape `OpsOverviewClient` renders on mount so there is
 * no layout shift once the client component takes over — its own sections
 * then stream in independently as each endpoint resolves.
 */
export default function OpsOverviewLoading() {
  return (
    <main id="main-content" className={styles.main}>
      <header className={styles.hero}>
        <div>
          <p className={styles.kicker}>Operator overview</p>
          <h1 className={styles.heading}>WivWav Health</h1>
        </div>
      </header>

      <div className={styles.bentoGrid}>
        <aside className={`${styles.bentoCard} ${styles.span4} ${styles.attentionCard}`} aria-hidden="true">
          <div className={styles.cardHeader}>
            <span>Attention Needed</span>
          </div>
          <div className={styles.attentionList}>
            <SkeletonListRow count={3} />
          </div>
        </aside>

        <div className={`${styles.bentoLabel} ${styles.span4}`}>
          <span>Service &amp; Queue Health</span>
        </div>
        {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}

        <div className={`${styles.bentoLabel} ${styles.span4}`}>
          <span>Listing Freshness</span>
        </div>
        {Array.from({ length: 5 }, (_, i) => <SkeletonCard key={i} />)}

        <div className={`${styles.bentoCard} ${styles.chartCard} ${styles.span4}`} aria-hidden="true">
          <div className={styles.chartCardHeader}>
            <span>Scrape Run History</span>
          </div>
          <div className={styles.chartCardBody}>
            <SkeletonChartBox aspectRatio="4/1" />
          </div>
        </div>
      </div>
    </main>
  )
}
