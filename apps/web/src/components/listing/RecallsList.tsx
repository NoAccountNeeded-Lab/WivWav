import { AlertTriangle, Check, HelpCircle } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { formatDate } from '@/app/[locale]/listings/[id]/utils'
import { recallStatusLabel } from '@/app/[locale]/listings/[id]/safetyTabUtils'
import type { Recall, SafetyData } from '@/app/[locale]/listings/[id]/types'
import styles from './RecallsList.module.css'

interface RecallsListProps {
  vin: string | null
  safety: SafetyData | null
}

/** NHTSA recall detail URL for a given campaign ID. */
function nhtsaRecallUrl(nhtsaCampaignId: string): string {
  return `https://www.nhtsa.gov/recalls?nhtsaId=${nhtsaCampaignId}`
}

export function RecallsList({ vin, safety }: RecallsListProps) {
  const t = useTranslations('RecallsList')
  const allRecalls = safety?.recalls ?? []
  const openRecalls = allRecalls.filter((r) => r.status === 'open')
  const historicalRecalls = allRecalls.filter((r) => r.status !== 'open')
  // Only reassure "nothing to do" when every closed recall has a confirmed
  // fix — a recall whose remedy is still 'unknown' isn't actually resolved,
  // so it must not be folded into a blanket "no action needed" claim.
  const allHistoricalRemedied = historicalRecalls.every((r) => r.status === 'remedied')

  return (
    <div>
      {vin && (
        <div className={styles.vinRow}>
          <span className={styles.vinKey}>{t('vin')}</span>
          <span className={styles.vinVal}>{vin}</span>
        </div>
      )}

      {safety === null || safety.vehicleModel === null ? (
        <p className={styles.placeholder}>
          {t('notAvailable')}
        </p>
      ) : (
        <>
          {/* Summary counts */}
          <div className={styles.recallSummary}>
            {openRecalls.length === 0 ? (
              <div className={styles.noRecalls}>
                <Check size={14} aria-hidden />
                {t('noOpenRecalls', {
                  year: safety.vehicleModel.year,
                  make: safety.vehicleModel.make,
                  model: safety.vehicleModel.model,
                })}
              </div>
            ) : (
              <div className={styles.recallSummaryCounts}>
                <span className={styles.recallCountOpen}>
                  {t('openRecalls', { count: openRecalls.length })}
                </span>
                {historicalRecalls.length > 0 && (
                  <span className={styles.recallCountHistorical}>
                    {t('historical', { count: historicalRecalls.length })}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Open recalls */}
          {openRecalls.length > 0 && (
            <>
              <div className={styles.recallGroupLabel}>{t('openGroup')}</div>
              <ul className={styles.list} aria-label={t('openListLabel')}>
                {openRecalls.map((recall) => (
                  <RecallItem key={recall.id} recall={recall} />
                ))}
              </ul>
            </>
          )}

          {/* Historical recalls */}
          {historicalRecalls.length > 0 && (
            <>
              <div className={styles.recallGroupLabel}>
                {t('closedGroup')}
                {openRecalls.length === 0 && allHistoricalRemedied && (
                  <span className={styles.recallGroupNote}>{t('noActionNeeded')}</span>
                )}
              </div>
              <ul className={styles.list} aria-label={t('closedListLabel')}>
                {historicalRecalls.map((recall) => (
                  <RecallItem key={recall.id} recall={recall} />
                ))}
              </ul>
            </>
          )}

          {/* Empty state when no recalls at all */}
          {allRecalls.length === 0 && (
            <p className={styles.placeholder}>
              {t('noRecords')}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function RecallItem({ recall }: { recall: Recall }) {
  const t = useTranslations('RecallsList')
  const safetyT = useTranslations('SafetyTab')
  const commonT = useTranslations('Common')
  const locale = useLocale()
  const { status } = recall
  const isOpen = status === 'open'
  const isUnknown = status === 'unknown'

  const statusClass = isOpen ? styles.statusOpen : isUnknown ? styles.statusCaution : styles.statusDone
  const iconClass = isOpen ? styles.iconWarn : isUnknown ? styles.iconCaution : styles.iconOk
  const Icon = isOpen ? AlertTriangle : isUnknown ? HelpCircle : Check

  return (
    <li className={styles.item}>
      <div className={iconClass} aria-hidden>
        <Icon size={14} />
      </div>
      <div>
        <div className={styles.title}>
          <a
            href={nhtsaRecallUrl(recall.nhtsaCampaignId)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.titleLink}
          >
            {t('campaign', { id: recall.nhtsaCampaignId })}
            <span className="sr-only"> {commonT('openInNewTab')}</span>
          </a>
          {' '}· {recall.component}
        </div>
        <div className={styles.sub}>{t('issued', { date: formatDate(recall.reportedAt, locale) })}</div>
        {recall.summary && <div className={styles.sub}>{recall.summary}</div>}
        {recall.remedy && (
          <div className={styles.remedy}>{t('remedy', { remedy: recall.remedy })}</div>
        )}
        <div className={styles.recallItemFooter}>
          <span className={statusClass}>
            {recallStatusLabel(status, safetyT)}
          </span>
        </div>
      </div>
    </li>
  )
}
