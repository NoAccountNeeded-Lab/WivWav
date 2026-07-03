import { Suspense } from 'react'
import Link from 'next/link'
import { Car } from 'lucide-react'
import { SortSelect } from '../../components/SearchFilters'
import { CategoryBarChart } from '../../components/CategoryBarChart'
import { ActiveFilters } from '../../components/ActiveFilters'
import { getServerApiBaseUrl } from '@/lib/api-url'
import { apiFetch } from '@/lib/api-fetch'
import { SiteHeader } from '@/components/SiteHeader'
import { NewBadge } from '@/components/NewBadge'
import { ListingsVisitSession } from '@/components/ListingsVisitSession'
import { buildSearchHref, countActiveResultFilters } from '@/lib/results-url'
import { vehicleDetailPath } from '@/lib/vehicle-url'
import styles from './page.module.css'

// ── Types ────────────────────────────────────────────────

interface ListingDoc {
  id: string
  make: string
  model: string
  year: number
  trim: string | null
  priceCents: number | null
  mileage: number | null
  city: string | null
  state: string | null
  lat: number | null
  lng: number | null
  condition: string
  sellerType: string
  conversionType: string
  wavFeatures: string[]
  rampType: string
  sourceUrl: string
  images: string[]
  listedAt: string
}

interface Pagination {
  page: number
  perPage: number
  total: number
  totalPages: number
}

interface ListingsResponse {
  data: ListingDoc[]
  pagination: Pagination
}

// ── Data fetching ────────────────────────────────────────

async function fetchListings(
  searchParams: Record<string, string>,
): Promise<ListingsResponse> {
  const base = getServerApiBaseUrl()
  const url = new URL(`${base}/v1/listings`)

  const forward = [
    'q', 'page', 'make', 'model',
    'yearMin', 'yearMax', 'priceMin', 'priceMax', 'mileageMax',
    'condition', 'conversionBrand', 'conversionType', 'rampType', 'wavFeatures', 'color', 'state', 'sellerType', 'sort',
  ]

  for (const key of forward) {
    const val = searchParams[key]
    if (val) url.searchParams.set(key, val)
  }

  if (!url.searchParams.has('sort')) {
    url.searchParams.set('sort', 'listedAt:desc')
  }

  const res = await apiFetch(url.toString(), { next: { revalidate: 0 } })
  if (!res.ok) throw new Error(`Listings fetch failed: ${res.status}`)
  return res.json() as Promise<ListingsResponse>
}

// ── Helpers ──────────────────────────────────────────────

function formatPrice(cents: number | null, locale: string, callForPrice: string): string {
  if (cents === null) return callForPrice
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function formatMileage(miles: number | null, locale: string): string | null {
  if (miles === null) return null
  return `${new Intl.NumberFormat(locale).format(miles)} mi`
}

function formatCondition(cond: string, cpo: string): string {
  if (cond === 'certified_pre_owned') return cpo
  return cond.charAt(0).toUpperCase() + cond.slice(1)
}

// ── Listing card ─────────────────────────────────────────

const WAV_FEATURE_LABELS: Record<string, string> = {
  has_lift:                'Wheelchair Lift',
  hand_controls:           'Hand Controls',
  transfer_seat:           'Transfer Seat',
  kneel_system:            'Kneel System',
  lowered_floor:           'Lowered Floor',
  power_ramp:              'Power Ramp',
  tie_down_system:         'Tie-Down System',
  automatic_door:          'Automatic Door',
  motorized_running_board: 'Motorized Running Board',
}

interface ListingLabels {
  callForPrice: string
  cpo: string
  rearEntry: string
  sideEntry: string
  inFloorRamp: string
  foldOutRamp: string
  foldInRamp: string
  privateSeller: string
  wavFeaturesLabel: string
}

function ListingCard({
  listing: l,
  locale,
  labels,
  listingPathPrefix,
}: {
  listing: ListingDoc
  locale: string
  labels: ListingLabels
  listingPathPrefix: string
}) {
  const badges: string[] = []
  const conversionLabel =
    l.conversionType === 'rear_entry'
      ? labels.rearEntry
      : l.conversionType === 'side_entry'
        ? labels.sideEntry
        : null
  const rampLabel =
    l.rampType === 'in_floor'
      ? labels.inFloorRamp
      : l.rampType === 'fold_out'
        ? labels.foldOutRamp
        : l.rampType === 'fold_in'
          ? labels.foldInRamp
          : null
  if (conversionLabel) badges.push(conversionLabel)
  if (rampLabel) badges.push(rampLabel)
  for (const f of l.wavFeatures) {
    const label = WAV_FEATURE_LABELS[f]
    if (label) badges.push(label)
  }
  const wavFeatures = badges

  const title = [l.year, l.make, l.model, l.trim].filter(Boolean).join(' ')
  const location = [l.city, l.state].filter(Boolean).join(', ')
  const mileage = formatMileage(l.mileage, locale)
  const heroImage = l.images?.[0] ?? null

  return (
    <article className={styles.card}>
      <Link href={vehicleDetailPath(l.id, listingPathPrefix)} className={styles.cardLink}>
        <div className={styles.cardImageWrap}>
          {heroImage ? (
            <img
              src={heroImage}
              alt=""
              className={styles.cardImage}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className={styles.cardImagePlaceholder} aria-hidden>
              <Car size={36} strokeWidth={1.25} />
            </div>
          )}
          <div className={styles.cardImageGradient} aria-hidden />
          <span className={styles.cardImagePrice}>
            {formatPrice(l.priceCents, locale, labels.callForPrice)}
          </span>
          {/* NewBadge renders only on the client after reading localStorage */}
          <NewBadge listedAt={l.listedAt} />
        </div>

        <div className={styles.cardBody}>
          <h2 className={styles.cardTitle}>{title}</h2>

          <p className={styles.cardMeta}>
            {mileage && <span className={styles.metaItem}>{mileage}</span>}
            {location && <span className={styles.metaItem}>{location}</span>}
            <span className={styles.metaItem}>{formatCondition(l.condition, labels.cpo)}</span>
            {l.sellerType === 'private' && (
              <span className={styles.metaItem}>{labels.privateSeller}</span>
            )}
          </p>

          {wavFeatures.length > 0 && (
            <ul className={styles.wavBadges} aria-label={labels.wavFeaturesLabel}>
              {wavFeatures.map((f) => (
                <li key={f} className={`${styles.badge} ${styles.badgeGreen}`}>
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Link>
    </article>
  )
}

// ── Pagination ───────────────────────────────────────────

function PaginationNav({
  pagination,
  currentParams,
  resultsPath,
  labels,
}: {
  pagination: Pagination
  currentParams: Record<string, string>
  resultsPath: string
  labels: Pick<ResultsPageLabels, 'paginationAriaLabel' | 'previous' | 'next' | 'pageOf'>
}) {
  const { page, totalPages } = pagination

  const buildHref = (p: number) => {
    return buildSearchHref(
      resultsPath,
      new URLSearchParams(currentParams),
      { page: String(p) },
    )
  }

  return (
    <nav aria-label={labels.paginationAriaLabel} className={styles.pagination}>
      {page > 1 ? (
        <Link href={buildHref(page - 1)} className={styles.paginationBtn}>
          {labels.previous}
        </Link>
      ) : (
        <span
          className={`${styles.paginationBtn} ${styles.paginationBtnDisabled}`}
          aria-disabled="true"
        >
          {labels.previous}
        </span>
      )}

      <span className={styles.paginationInfo} aria-current="page">
        {labels.pageOf(page, totalPages)}
      </span>

      {page < totalPages ? (
        <Link href={buildHref(page + 1)} className={styles.paginationBtn}>
          {labels.next}
        </Link>
      ) : (
        <span
          className={`${styles.paginationBtn} ${styles.paginationBtnDisabled}`}
          aria-disabled="true"
        >
          {labels.next}
        </span>
      )}
    </nav>
  )
}

// ── Page ─────────────────────────────────────────────────

interface ListingsPageProps {
  searchParams: Promise<Record<string, string>>
}

export interface ResultsPageLabels {
  personalizedHeading: string
  personalizedSummary: (count: number) => string
  browseAllSummary: string
  searchResultsLabel: string
  vehiclesFound: (count: number) => string
  noVehicles: string
  noVehiclesForBrand: string
  clearAllFilters: string
  paginationAriaLabel: string
  previous: string
  next: string
  pageOf: (page: number, totalPages: number) => string
  listing: ListingLabels
}

const DEFAULT_LABELS: ResultsPageLabels = {
  personalizedHeading: 'Your personalized vehicle matches',
  personalizedSummary: (count) =>
    `${count} ${count === 1 ? 'filter is' : 'filters are'} shaping these results. Bookmark this page to return to the same search.`,
  browseAllSummary:
    'Browse all available vehicles, or add filters below to personalize these results.',
  searchResultsLabel: 'Search results',
  vehiclesFound: (count) => `${count.toLocaleString()} ${count === 1 ? 'vehicle' : 'vehicles'} found`,
  noVehicles: 'No vehicles match your current filters.',
  noVehiclesForBrand:
    'No vehicles match the selected conversion brand. Try another brand or clear the brand filter.',
  clearAllFilters: 'Clear all filters',
  paginationAriaLabel: 'Pagination',
  previous: 'Previous',
  next: 'Next',
  pageOf: (page, totalPages) => `Page ${page} of ${totalPages}`,
  listing: {
    callForPrice: 'Call for price',
    cpo: 'CPO',
    rearEntry: 'Rear entry',
    sideEntry: 'Side entry',
    inFloorRamp: 'In-floor ramp',
    foldOutRamp: 'Fold-out ramp',
    foldInRamp: 'Fold-in ramp',
    privateSeller: 'Private seller',
    wavFeaturesLabel: 'WAV features',
  },
}

interface ListingsResultsProps extends ListingsPageProps {
  resultsPath?: string
  locale?: string
  labels?: ResultsPageLabels
  personalized?: boolean
}

export async function ListingsResults({
  searchParams,
  resultsPath = '/filters',
  locale = 'en-US',
  labels = DEFAULT_LABELS,
  personalized = false,
}: ListingsResultsProps) {
  const params = await searchParams
  const { data: listings, pagination } = await fetchListings(params)
  const hasConversionBrandFilter = Boolean(params.conversionBrand)
  const activeFilterCount = countActiveResultFilters(new URLSearchParams(params))
  const listingPathPrefix = resultsPath.endsWith('/results')
    ? resultsPath.slice(0, -'/results'.length)
    : ''

  return (
    <>
      <SiteHeader />

      <main id="main-content" className={styles.main}>
        <div className={styles.container}>

          {personalized && (
            <header className={styles.personalizedHeader}>
              <h1 className={styles.personalizedHeading}>{labels.personalizedHeading}</h1>
              <p className={styles.personalizedSummary}>
                {activeFilterCount > 0
                  ? labels.personalizedSummary(activeFilterCount)
                  : labels.browseAllSummary}
              </p>
            </header>
          )}

          <section className={styles.searchSection}>
            {/* Client components use useSearchParams — must be in Suspense */}
            <Suspense>
              <CategoryBarChart />
            </Suspense>
          </section>

          <section aria-label={labels.searchResultsLabel} className={styles.resultsSection}>
            <div className={styles.resultsHeader}>
              <p
                className={styles.resultsCount}
                aria-live="polite"
                aria-atomic="true"
              >
                {labels.vehiclesFound(pagination.total)}
              </p>
              <Suspense>
                <SortSelect />
              </Suspense>
            </div>
            <Suspense>
              <ActiveFilters />
            </Suspense>

            {listings.length > 0 ? (
              <ListingsVisitSession>
                <ul className={styles.listingsGrid} role="list">
                  {listings.map((listing) => (
                    <li key={listing.id}>
                      <ListingCard
                        listing={listing}
                        locale={locale}
                        labels={labels.listing}
                        listingPathPrefix={listingPathPrefix}
                      />
                    </li>
                  ))}
                </ul>

                {pagination.totalPages > 1 && (
                  <PaginationNav
                    pagination={pagination}
                    currentParams={params}
                    resultsPath={resultsPath}
                    labels={labels}
                  />
                )}
              </ListingsVisitSession>
            ) : (
              <div className={styles.emptyState} role="status">
                <p>
                  {hasConversionBrandFilter ? labels.noVehiclesForBrand : labels.noVehicles}
                </p>
                <a href={resultsPath}>{labels.clearAllFilters}</a>
              </div>
            )}
          </section>

        </div>
      </main>
    </>
  )
}

export default function ListingsPage(props: ListingsPageProps) {
  return <ListingsResults {...props} />
}
