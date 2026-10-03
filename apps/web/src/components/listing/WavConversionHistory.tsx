import { useLocale, useTranslations } from 'next-intl'
import { formatDate } from '@/app/[locale]/listings/[id]/utils'
import type { ConversionHistoryEntry } from '@/app/[locale]/listings/[id]/types'
import styles from './WavConversionHistory.module.css'

interface WavConversionHistoryProps {
  /**
   * Raw `listing_conversion_history` snapshots (any order, may include
   * consecutive duplicates — the scraper writes one row per ingest pass
   * regardless of whether values changed, #921).
   */
  history: ConversionHistoryEntry[]
}

interface ConversionChange {
  id: string
  recordedAt: string
  statusChange: { from: string; to: string } | null
  featuresAdded: string[]
  featuresRemoved: string[]
}

function sameFeatureSet(a: string[], b: string[]): boolean {
  // Compare as sets, not arrays — dedupes any repeated feature within a
  // single snapshot so a duplicate doesn't register as a spurious change.
  const setA = new Set(a)
  const setB = new Set(b)
  if (setA.size !== setB.size) return false
  return [...setB].every((feature) => setA.has(feature))
}

/**
 * Collapses raw snapshots (ordered chronologically) into a changelog of
 * actual changes, skipping consecutive snapshots with identical status and
 * feature set. Returns an empty list when fewer than two distinct snapshots
 * exist — the common case, which the caller uses to decide not to render.
 */
export function buildConversionChangelog(history: ConversionHistoryEntry[]): ConversionChange[] {
  const sorted = [...history].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  )

  const distinct: ConversionHistoryEntry[] = []
  for (const entry of sorted) {
    const prev = distinct[distinct.length - 1]
    if (prev && prev.conversionStatus === entry.conversionStatus && sameFeatureSet(prev.wavFeatures, entry.wavFeatures)) {
      continue
    }
    distinct.push(entry)
  }

  if (distinct.length < 2) return []

  const changes: ConversionChange[] = []
  for (let i = 1; i < distinct.length; i++) {
    const prev = distinct[i - 1]!
    const curr = distinct[i]!
    const prevFeatures = new Set(prev.wavFeatures)
    const currFeatures = new Set(curr.wavFeatures)

    changes.push({
      id: curr.id,
      recordedAt: curr.recordedAt,
      statusChange:
        prev.conversionStatus !== curr.conversionStatus
          ? { from: prev.conversionStatus, to: curr.conversionStatus }
          : null,
      featuresAdded: curr.wavFeatures.filter((feature) => !prevFeatures.has(feature)),
      featuresRemoved: prev.wavFeatures.filter((feature) => !currFeatures.has(feature)),
    })
  }
  return changes
}

export function WavConversionHistory({ history }: WavConversionHistoryProps) {
  const t = useTranslations('WavConversionHistory')
  const featureT = useTranslations('FiltersPage.listing')
  const locale = useLocale()
  const changes = buildConversionChangelog(history)

  if (changes.length === 0) return null

  const statusLabel = (status: string) =>
    status === 'complete' || status === 'proposed' ? t(`status.${status}`) : t('status.unknown')
  const featureLabel = (feature: string) =>
    featureT.has(`wavFeature_${feature}`) ? featureT(`wavFeature_${feature}`) : feature
  const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>

  return (
    <section className={styles.historySection} aria-labelledby="conversion-history-heading">
      <h2 id="conversion-history-heading" className={styles.sectionTitle}>
        {t('title')}
      </h2>
      <ul className={styles.changeList}>
        {changes.map((change) => (
          <li key={change.id} className={styles.changeItem}>
            <div className={styles.changeDate}>{formatDate(change.recordedAt, locale)}</div>
            <div className={styles.changeLines}>
              {change.statusChange && (
                <div className={styles.changeLine}>
                  {t.rich('statusChanged', {
                    from: statusLabel(change.statusChange.from),
                    to: statusLabel(change.statusChange.to),
                    strong,
                  })}
                </div>
              )}
              {change.featuresAdded.map((feature) => (
                <div key={`added-${feature}`} className={styles.changeLine}>
                  {t.rich('featureAdded', { feature: featureLabel(feature), strong })}
                </div>
              ))}
              {change.featuresRemoved.map((feature) => (
                <div key={`removed-${feature}`} className={styles.changeLine}>
                  {t.rich('featureRemoved', { feature: featureLabel(feature), strong })}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
