import { SkeletonCard, SkeletonChartBox, SkeletonListRow } from '@/components/Skeleton'
import styles from './page.module.css'

/**
 * Route-level Suspense fallback for `/ops` (E5, issue #732). Mirrors the
 * hero + bento-grid shape `OpsOverviewClient` renders on mount — including
 * every fixed section (health, freshness, chart, telemetry gaps) at the
 * same column spans as `CARD_COL_SPAN` in OpsOverviewClient.tsx — so there
 * is no layout shift once the client component takes over. (The per-queue
 * breakdown card is conditional on data and intentionally omitted here.)
 */

// Column spans below must stay in sync with CARD_COL_SPAN / card order in
// OpsOverviewClient.tsx: health = [api, postgres, valkey, meilisearch,
// queues, scraper]; freshness = [active-listings, last-successful-scrape,
// sources-needing-remap, geocode-readiness, search-readiness]; telemetry =
// [missing-coordinates, search-sync-age, listing-freshness-window].
const HEALTH_CARD_SPANS = [1, 1, 1, 1, 2, 2]
const FRESHNESS_CARD_SPANS = [2, 1, 1, 2, 2]
const TELEMETRY_CARD_SPANS = [2, 1, 1]

function spanClass(span: number): string | undefined {
  return span === 2 ? styles.span2 : span === 3 ? styles.span3 : undefined
}

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
        {HEALTH_CARD_SPANS.map((span, i) => (
          <div key={i} className={[styles.metricCardWrap, spanClass(span)].filter(Boolean).join(' ')}>
            <SkeletonCard />
          </div>
        ))}

        <div className={`${styles.bentoLabel} ${styles.span4}`}>
          <span>Listing Freshness</span>
        </div>
        {FRESHNESS_CARD_SPANS.map((span, i) => (
          <div key={i} className={[styles.metricCardWrap, spanClass(span)].filter(Boolean).join(' ')}>
            <SkeletonCard />
          </div>
        ))}

        <div className={`${styles.bentoCard} ${styles.chartCard} ${styles.span4}`} aria-hidden="true">
          <div className={styles.chartCardHeader}>
            <span>Scrape Run History</span>
          </div>
          <div className={styles.chartCardBody}>
            <SkeletonChartBox aspectRatio="4/1" />
          </div>
        </div>

        <div className={`${styles.bentoLabel} ${styles.span4}`}>
          <span>Telemetry Gaps</span>
        </div>
        {TELEMETRY_CARD_SPANS.map((span, i) => (
          <div key={i} className={[styles.metricCardWrap, spanClass(span)].filter(Boolean).join(' ')}>
            <SkeletonCard />
          </div>
        ))}
      </div>
    </main>
  )
}
