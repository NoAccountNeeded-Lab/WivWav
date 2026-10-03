import { getLocale, getTranslations } from 'next-intl/server'
import { Link } from '@/navigation'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { RecallsList } from '@/components/listing/RecallsList'
import { SafetyRatings } from '@/components/listing/SafetyRatings'
import { SafetyStatusBadge } from '@/components/listing/SafetyStatusBadge'
import { formatFreshnessDate, isSafetyDataStale } from './safetyTabUtils'
import { SafetyRefreshButton } from '@/components/listing/SafetyRefreshButton'
import { ListingDisclaimer } from '@/components/listing/ListingDisclaimer'
import { formatDate } from './utils'
import type { Translate } from '@/lib/intl'
import { toIntlLocale } from '@/lib/intl'
import type { Investigation, ListingDetail, ManufacturerCommunication, SafetyData } from './types'
import styles from './tabs.module.css'

interface SafetyTabProps {
  listing: ListingDetail
  safety: SafetyData | null
  apiBaseUrl: string
}

export async function SafetyTab({ listing, safety, apiBaseUrl }: SafetyTabProps) {
  const t = await getTranslations('SafetyTab')
  const commonT = await getTranslations('Common')
  const locale = await getLocale()
  const openRecallCount = (safety?.recalls ?? []).filter((r) => r.status === 'open').length

  const rating = safety?.safetyRatings?.[0]
  const freshnessDate = safety?.safetyFreshnessDate ?? null
  const formattedDate = formatFreshnessDate(freshnessDate, locale)
  const isStale = isSafetyDataStale(freshnessDate)

  const investigations = safety?.investigations ?? []
  const manufacturerCommunications = safety?.manufacturerCommunications ?? []
  const complaints = safety?.complaints ?? []

  return (
    <div className={styles.tabContent}>
      {/* Freshness banner */}
      {safety !== null && (
        <div className={styles.freshnessBanner} role="note">
          {formattedDate !== null ? (
            <>
              <span>{t('dataAsOf', { date: formattedDate })}</span>
              {isStale && (
                <span className={styles.staleWarning}>
                  <AlertTriangle size={12} aria-hidden />
                  {' '}{t('dataMayBeOutdated')}
                </span>
              )}
            </>
          ) : (
            <span className={styles.staleWarning}>
              <AlertTriangle size={12} aria-hidden />
              {' '}{t('freshnessUnknown')}
            </span>
          )}
          {(isStale || formattedDate === null) && (
            <SafetyRefreshButton listingId={listing.id} apiBaseUrl={apiBaseUrl} />
          )}
        </div>
      )}

      {safety !== null && (
        <SafetyStatusBadge
          openRecallCount={openRecallCount}
          overallRating={rating?.overallRating ?? null}
        />
      )}

      {listing.vin && (
        <div className={styles.ctaWrap}>
          <Link href={`/vin/${encodeURIComponent(listing.vin)}`} className={styles.ctaSecondary}>
            <ShieldCheck size={16} aria-hidden />
            {t('viewSafetyReport')}
          </Link>
        </div>
      )}

      <ListingDisclaimer categories={['safety']} />

      <div className={styles.section}>
        <div className={styles.sectionLabelRow}>
          <AlertTriangle size={12} aria-hidden />
          {t('recallsAndVinHistory')}
          {/* role="status" lives on the SafetyStatusBadge above, which already
              announces this same open-recall count as the page's single
              at-a-glance summary — this in-section count stays a plain,
              non-live-region label so screen readers don't hear it twice. */}
          {openRecallCount > 0 && (
            <span className={styles.recallBadge}>
              {t('openCount', { count: openRecallCount })}
            </span>
          )}
        </div>
        <RecallsList vin={listing.vin} safety={safety} />
      </div>

      {rating != null && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>{t('nhtsaRatings')}</div>
          <SafetyRatings rating={rating} />
        </div>
      )}

      {rating == null && safety !== null && (
        <p className={styles.placeholder}>
          {t('noRatings')}
        </p>
      )}

      {complaints.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>
            {t('complaints')}
            <span className={styles.sectionCount}>{complaints.length}</span>
          </div>
          <ul className={styles.safetyItemList} aria-label={t('complaints')}>
            {complaints.map((complaint) => (
              <li key={complaint.id} className={styles.safetyItem}>
                <div>
                  <div className={styles.safetyItemTitle}>{complaint.component}</div>
                  {complaint.mileage != null && (
                    <div className={styles.safetyItemSub}>
                      {t('atMiles', { miles: complaint.mileage.toLocaleString(toIntlLocale(locale)) })}
                    </div>
                  )}
                  <div className={styles.safetyItemSub}>
                    <span>{t('reported', { date: formatDate(complaint.reportedAt, locale) })}</span>
                    <span
                      className={
                        complaint.crashInvolved
                          ? styles.safetyItemBadgeCrash
                          : styles.safetyItemBadgeClosed
                      }
                    >
                      {complaint.crashInvolved ? t('crashInvolved') : t('noCrash')}
                    </span>
                  </div>
                  {complaint.summary && (
                    <div className={styles.safetyItemSub}>{complaint.summary}</div>
                  )}
                  <a
                    href={`https://www.nhtsa.gov/vehicle/complaints#${complaint.nhtsaId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.safetyItemSource}
                  >
                    {t('complaintNumber', { id: complaint.nhtsaId })}
                    <span className="sr-only"> {commonT('openInNewTab')}</span>
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {investigations.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>{t('investigations')}</div>
          <ul className={styles.safetyItemList} aria-label={t('investigations')}>
            {investigations.map((inv) => (
              <InvestigationItem key={inv.id} investigation={inv} t={t} commonT={commonT} locale={locale} />
            ))}
          </ul>
        </div>
      )}

      {manufacturerCommunications.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>{t('bulletins')}</div>
          <ul className={styles.safetyItemList} aria-label={t('bulletins')}>
            {manufacturerCommunications.map((comm) => (
              <ManufacturerCommunicationItem key={comm.id} communication={comm} t={t} commonT={commonT} locale={locale} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

interface ItemI18n {
  t: Translate
  commonT: Translate
  locale: string
}

function InvestigationItem({
  investigation,
  t,
  commonT,
  locale,
}: { investigation: Investigation } & ItemI18n) {
  const isOpen = investigation.closedDate === null
  return (
    <li className={styles.safetyItem}>
      <div>
        <div className={styles.safetyItemTitle}>
          {t('investigationTitle', { id: investigation.nhtsaId, component: investigation.component })}
        </div>
        <div className={styles.safetyItemSub}>
          {t('opened', { date: formatDate(investigation.openedDate, locale) })}
          {isOpen ? (
            <span className={styles.safetyItemBadgeOpen}>{t('open')}</span>
          ) : (
            <span className={styles.safetyItemBadgeClosed}>{t('closed')}</span>
          )}
        </div>
        {investigation.summary && (
          <div className={styles.safetyItemSub}>{investigation.summary}</div>
        )}
        {investigation.outcome && (
          <div className={styles.safetyItemSub}>{t('outcome', { outcome: investigation.outcome })}</div>
        )}
        <a
          href={investigation.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.safetyItemSource}
        >
          {t('nhtsaSource')}
          <span className="sr-only"> {commonT('openInNewTab')}</span>
        </a>
      </div>
    </li>
  )
}

function ManufacturerCommunicationItem({
  communication,
  t,
  commonT,
  locale,
}: { communication: ManufacturerCommunication } & ItemI18n) {
  return (
    <li className={styles.safetyItem}>
      <div>
        <div className={styles.safetyItemTitle}>
          {t('bulletinTitle', { id: communication.nhtsaId, component: communication.component })}
        </div>
        <div className={styles.safetyItemSub}>{t('issued', { date: formatDate(communication.issuedDate, locale) })}</div>
        {communication.summary && (
          <div className={styles.safetyItemSub}>{communication.summary}</div>
        )}
        <a
          href={communication.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.safetyItemSource}
        >
          {t('nhtsaSource')}
          <span className="sr-only"> {commonT('openInNewTab')}</span>
        </a>
      </div>
    </li>
  )
}
