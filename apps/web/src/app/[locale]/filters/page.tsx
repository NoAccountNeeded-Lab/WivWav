import { Suspense } from 'react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Car } from 'lucide-react'
import { SortSelect } from '@/components/SearchFilters'
import { CategoryBarChart } from '@/components/CategoryBarChart'
import { ActiveFilters } from '@/components/ActiveFilters'
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

type ListingsFetchResult =
  | { ok: true; data: ListingDoc[]; pagination: Pagination }
  | { ok: false }

// ── Data fetching ────────────────────────────────────────

async function fetchListings(
  searchParams: Record<string, string>,
): Promise<ListingsFetchResult> {
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

  // The API returns an explicit 503 error envelope when search is down
  // (#669) rather than silently dropping filters — render an honest
  // degraded state instead of throwing into the framework's generic error
  // boundary, which would lose the page chrome and any request context.
  const res = await apiFetch(url.toString(), { next: { revalidate: 0 } })
  if (!res.ok) return { ok: false }
  const body = await res.json() as ListingsResponse
  return { ok: true, data: body.data, pagination: body.pagination }
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

function formatCondition(cond: string, labels: Pick<ListingLabels, 'cpo' | 'conditionUsed' | 'conditionNew' | 'conditionUnknown'>): string {
  if (cond === 'certified_pre_owned') return labels.cpo
  if (cond === 'used') return labels.conditionUsed
  if (cond === 'new') return labels.conditionNew
  return labels.conditionUnknown
}

// ── Listing card ─────────────────────────────────────────

interface ListingLabels {
  callForPrice: string
  cpo: string
  conditionUsed: string
  conditionNew: string
  conditionUnknown: string
  rearEntry: string
  sideEntry: string
  inFloorRamp: string
  foldOutRamp: string
  foldInRamp: string
  privateSeller: string
  wavFeaturesLabel: string
  wavFeature_has_lift: string
  wavFeature_hand_controls: string
  wavFeature_transfer_seat: string
  wavFeature_kneel_system: string
  wavFeature_lowered_floor: string
  wavFeature_power_ramp: string
  wavFeature_tie_down_system: string
  wavFeature_automatic_door: string
  wavFeature_motorized_running_board: string
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
    const key = `wavFeature_${f}` as keyof ListingLabels
    const label: string | undefined = Object.hasOwn(labels, key) ? labels[key] : undefined
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
            <span className={styles.metaItem}>{formatCondition(l.condition, labels)}</span>
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
  labels: Pick<PageLabels, 'paginationAriaLabel' | 'previous' | 'next' | 'pageOf'>
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

// ── Labels ───────────────────────────────────────────────

interface PageLabels {
  personalizedHeading: string
  personalizedSummary: (count: number) => string
  browseAllSummary: string
  searchResultsLabel: string
  vehiclesFound: (count: number) => string
  noVehicles: string
  noVehiclesForBrand: string
  clearAllFilters: string
  searchUnavailableHeading: string
  searchUnavailableMessage: string
  paginationAriaLabel: string
  previous: string
  next: string
  pageOf: (page: number, totalPages: number) => string
  listing: ListingLabels
}

async function getPageLabels(): Promise<PageLabels> {
  const t = await getTranslations('FiltersPage')
  return {
    personalizedHeading: t('personalizedHeading'),
    personalizedSummary: (count) => t('personalizedSummary', { count }),
    browseAllSummary: t('browseAllSummary'),
    searchResultsLabel: t('searchResultsLabel'),
    vehiclesFound: (count) => t('vehiclesFound', { count }),
    noVehicles: t('noVehicles'),
    noVehiclesForBrand: t('noVehiclesForBrand'),
    clearAllFilters: t('clearAllFilters'),
    searchUnavailableHeading: t('searchUnavailableHeading'),
    searchUnavailableMessage: t('searchUnavailableMessage'),
    paginationAriaLabel: t('pagination.ariaLabel'),
    previous: t('pagination.previous'),
    next: t('pagination.next'),
    pageOf: (page, totalPages) => t('pagination.pageOf', { page, totalPages }),
    listing: {
      callForPrice: t('listing.callForPrice'),
      cpo: t('listing.cpo'),
      conditionUsed: t('listing.conditionUsed'),
      conditionNew: t('listing.conditionNew'),
      conditionUnknown: t('listing.conditionUnknown'),
      rearEntry: t('listing.rearEntry'),
      sideEntry: t('listing.sideEntry'),
      inFloorRamp: t('listing.inFloorRamp'),
      foldOutRamp: t('listing.foldOutRamp'),
      foldInRamp: t('listing.foldInRamp'),
      privateSeller: t('listing.privateSeller'),
      wavFeaturesLabel: t('listing.wavFeaturesLabel'),
      wavFeature_has_lift: t('listing.wavFeature_has_lift'),
      wavFeature_hand_controls: t('listing.wavFeature_hand_controls'),
      wavFeature_transfer_seat: t('listing.wavFeature_transfer_seat'),
      wavFeature_kneel_system: t('listing.wavFeature_kneel_system'),
      wavFeature_lowered_floor: t('listing.wavFeature_lowered_floor'),
      wavFeature_power_ramp: t('listing.wavFeature_power_ramp'),
      wavFeature_tie_down_system: t('listing.wavFeature_tie_down_system'),
      wavFeature_automatic_door: t('listing.wavFeature_automatic_door'),
      wavFeature_motorized_running_board: t('listing.wavFeature_motorized_running_board'),
    },
  }
}

// ── Page ─────────────────────────────────────────────────

interface ListingsPageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string>>
}

interface ListingsResultsProps {
  searchParams: Promise<Record<string, string>>
  locale: string
  resultsPath: string
  personalized?: boolean
}

export async function ListingsResults({
  searchParams,
  locale,
  resultsPath,
  personalized = false,
}: ListingsResultsProps) {
  const labels = await getPageLabels()
  const params = await searchParams
  const result = await fetchListings(params)
  const hasConversionBrandFilter = Boolean(params.conversionBrand)
  const activeFilterCount = countActiveResultFilters(new URLSearchParams(params))
  const listingPathPrefix = `/${locale}`

  // Search is down (#669) — render an honest, accessible degraded state
  // instead of a partial page built from data we don't have. `role="alert"`
  // announces the failure to assistive tech immediately, without requiring
  // the user to discover a silently empty results grid.
  if (!result.ok) {
    return (
      <>
        <SiteHeader locale={locale} />
        <main id="main-content" className={styles.main}>
          <div className={styles.container}>
            <div className={styles.emptyState} role="alert">
              <h1>{labels.searchUnavailableHeading}</h1>
              <p>{labels.searchUnavailableMessage}</p>
            </div>
          </div>
        </main>
      </>
    )
  }

  const { data: listings, pagination } = result

  return (
    <>
      <SiteHeader locale={locale} />

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
              <CategoryBarChart renderers={{ color: 'swatches', seller: 'donut', condition: 'donut' }} />
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

export default async function ListingsPage({ params, searchParams }: ListingsPageProps) {
  const { locale } = await params
  return (
    <ListingsResults
      searchParams={searchParams}
      locale={locale}
      resultsPath={`/${locale}/filters`}
    />
  )
}
