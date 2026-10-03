import type { Metadata } from 'next'
import { AlertTriangle, CheckCircle2, ChevronLeft, ShieldCheck, Star } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import type { Translate } from '@/lib/intl'
import { toIntlLocale } from '@/lib/intl'
import { getServerApiBaseUrl } from '@/lib/api-url'
import { apiFetch } from '@/lib/api-fetch'
import { VinSearchForm } from '../VinSearchForm'
import styles from '../page.module.css'

interface DecodedVin {
  make: string
  model: string
  year: number
  trim: string | null
  bodyType: string | null
}

interface Recall {
  id: string
  nhtsaCampaignId: string
  component: string
  summary: string
  remedy: string | null
  reportedAt: string
}

interface ComplaintExample {
  id: string
  nhtsaId: string
  summary: string
  mileage: number | null
  crashInvolved: boolean
  reportedAt: string
}

interface ComplaintGroup {
  component: string
  count: number
  examples: ComplaintExample[]
}

interface SafetyRating {
  id: string
  nhtsaVehicleId: number
  description: string | null
  overallRating: number | null
  frontCrashRating: number | null
  sideCrashRating: number | null
  rolloverRating: number | null
  rolloverRatingText: string | null
}

interface VinSafetyReport {
  vin: string
  decoded: DecodedVin | null
  vehicleModel: DecodedVin & { id: string } | null
  conversionManufacturer: string | null
  sourceListingId: string | null
  recalls: Recall[]
  complaintGroups: ComplaintGroup[]
  safetyRatings: SafetyRating[]
  checkedAt: string
}

interface ApiError {
  code: string
  message: string
}

async function getVinReport(
  vin: string,
  lookupFailedMessage: string,
): Promise<{ data: VinSafetyReport | null; error: ApiError | null }> {
  const res = await apiFetch(`${getServerApiBaseUrl()}/v1/vin/${encodeURIComponent(vin)}/safety`, {
    next: { revalidate: 86400 },
  })
  const json = (await res.json()) as { data?: VinSafetyReport; error?: ApiError }

  if (!res.ok) return { data: null, error: json.error ?? { code: 'VIN_LOOKUP_FAILED', message: lookupFailedMessage } }
  return { data: json.data ?? null, error: null }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; vin: string }>
}): Promise<Metadata> {
  const { locale, vin } = await params
  const t = await getTranslations({ locale, namespace: 'VinReport' })
  return {
    title: t('metaTitle', { vin: vin.toUpperCase() }),
    description: t('metaDescription'),
  }
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(toIntlLocale(locale), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatRating(value: number | null, t: Translate): string {
  return value === null ? t('notRated') : `${value}/5`
}

function vehicleName(decoded: DecodedVin): string {
  return `${decoded.year} ${decoded.make} ${decoded.model}${decoded.trim ? ` ${decoded.trim}` : ''}`
}

export default async function VinReportPage({
  params,
}: {
  params: Promise<{ locale: string; vin: string }>
}) {
  const { locale, vin } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'VinReport' })
  const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>
  const normalizedVin = vin.toUpperCase()
  const { data: report, error } = await getVinReport(normalizedVin, t('lookupFailed'))

  return (
    <main id="main-content" className={styles.page}>
      <Link href="/filters" className={styles.back}>
        <ChevronLeft size={16} aria-hidden />
        {t('back')}
      </Link>

      <header className={styles.header}>
        <p className={styles.eyebrow}>{t('eyebrow')}</p>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.lede}>{normalizedVin}</p>
        <VinSearchForm initialVin={normalizedVin} />
      </header>

      {error && (
        <section className={styles.section} aria-labelledby="vin-error-heading">
          <h2 className={styles.sectionTitle} id="vin-error-heading">{t('errorHeading')}</h2>
          <div className={`${styles.notice} ${styles.warningNotice}`}>
            <strong>{error.message}</strong> {t('errorHint')}
          </div>
        </section>
      )}

      {report && !report.decoded && (
        <section className={styles.section} aria-labelledby="vin-unknown-heading">
          <h2 className={styles.sectionTitle} id="vin-unknown-heading">{t('undecodedHeading')}</h2>
          <div className={styles.notice}>
            {t.rich('undecoded', { strong })}
          </div>
        </section>
      )}

      {report?.decoded && (
        <>
          <section className={styles.section} aria-labelledby="summary-heading">
            <h2 className={styles.sectionTitle} id="summary-heading">{t('summary')}</h2>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>{t('decodedVehicle')}</span>
                <span className={styles.summaryValue}>
                  <ShieldCheck size={18} aria-hidden />
                  {vehicleName(report.decoded)}
                </span>
                {report.decoded.bodyType && <span className={styles.summaryDetail}>{report.decoded.bodyType}</span>}
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>{t('recallCampaigns')}</span>
                <span className={styles.summaryValue}>
                  {report.recalls.length > 0 ? <AlertTriangle size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
                  {report.recalls.length}
                </span>
                <span className={styles.summaryDetail}>{t('checked', { date: formatDate(report.checkedAt, locale) })}</span>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>{t('overallRating')}</span>
                <span className={styles.summaryValue}>
                  <Star size={18} aria-hidden />
                  {report.safetyRatings[0] ? formatRating(report.safetyRatings[0].overallRating, t) : t('notRated')}
                </span>
                <span className={styles.summaryDetail}>{t('ratingNote')}</span>
              </div>
            </div>
          </section>

          {report.conversionManufacturer && (
            <section className={styles.section} aria-labelledby="conversion-heading">
              <h2 className={styles.sectionTitle} id="conversion-heading">{t('conversionHeading')}</h2>
              <div className={styles.notice}>
                {t.rich('conversion', { manufacturer: report.conversionManufacturer, strong })}
                {report.sourceListingId && (
                  <>
                    {' '}
                    <Link className={styles.link} href={`/filters/${report.sourceListingId}`}>{t('viewSource')}</Link>
                  </>
                )}
              </div>
            </section>
          )}

          <section className={styles.section} aria-labelledby="recalls-heading">
            <h2 className={styles.sectionTitle} id="recalls-heading">{t('recallCampaigns')}</h2>
            {report.recalls.length === 0 ? (
              <div className={styles.notice}>
                {t.rich('noOpenRecalls', { date: formatDate(report.checkedAt, locale), strong })}
              </div>
            ) : (
              <ul className={styles.recallList}>
                {report.recalls.map((recall) => (
                  <li key={recall.id} className={styles.recallItem}>
                    <div className={styles.itemHeader}>
                      <h3 className={styles.itemTitle}>{recall.component}</h3>
                      <span className={styles.badge}>{recall.nhtsaCampaignId}</span>
                    </div>
                    <p className={styles.itemMeta}>{t('reported', { date: formatDate(recall.reportedAt, locale) })}</p>
                    <p className={styles.itemText}>{recall.summary}</p>
                    {recall.remedy && <p className={styles.itemText}>{t.rich('remedy', { remedy: recall.remedy, strong })}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.section} aria-labelledby="complaints-heading">
            <h2 className={styles.sectionTitle} id="complaints-heading">{t('complaintPatterns')}</h2>
            {report.complaintGroups.length === 0 ? (
              <div className={styles.notice}>{t('noComplaints')}</div>
            ) : (
              <ul className={styles.complaintList}>
                {report.complaintGroups.map((group) => (
                  <li key={group.component} className={styles.complaintItem}>
                    <div className={styles.itemHeader}>
                      <h3 className={styles.itemTitle}>{group.component}</h3>
                      <span className={styles.badge}>{t('complaintCount', { count: group.count })}</span>
                    </div>
                    <ul className={styles.exampleList}>
                      {group.examples.map((example) => (
                        <li key={example.id}>
                          {example.summary}
                          {example.mileage !== null
            ? t('exampleMiles', { miles: example.mileage.toLocaleString(toIntlLocale(locale)) })
            : ''}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.section} aria-labelledby="ratings-heading">
            <h2 className={styles.sectionTitle} id="ratings-heading">{t('ratingsHeading')}</h2>
            {report.safetyRatings.length === 0 ? (
              <div className={styles.notice}>{t('noRatings')}</div>
            ) : (
              <ul className={styles.ratingList}>
                {report.safetyRatings.map((rating) => (
                  <li key={rating.id} className={styles.ratingItem}>
                    <h3 className={styles.itemTitle}>{rating.description ?? t('ratingFallback')}</h3>
                    <div className={styles.ratingGrid}>
                      <RatingMetric label={t('overall')} value={formatRating(rating.overallRating, t)} />
                      <RatingMetric label={t('frontCrash')} value={formatRating(rating.frontCrashRating, t)} />
                      <RatingMetric label={t('sideCrash')} value={formatRating(rating.sideCrashRating, t)} />
                      <RatingMetric label={t('rollover')} value={rating.rolloverRatingText ?? formatRating(rating.rolloverRating, t)} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  )
}

function RatingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.ratingMetric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{value}</span>
    </div>
  )
}
