import { Suspense } from 'react'
import { getTranslations, getLocale } from 'next-intl/server'
import { Car } from 'lucide-react'
import { Link } from '@/navigation'
import { SortSelect } from '@/components/SearchFilters'
import { CategoryBarChart } from '@/components/CategoryBarChart'
import { ActiveFilters } from '@/components/ActiveFilters'
import { vehicleDetailPath } from '@/lib/vehicle-url'
import { getServerApiBaseUrl } from '@/lib/api-url'
import { apiFetch } from '@/lib/api-fetch'
import { SiteHeader } from '@/components/SiteHeader'
import { NewBadge } from '@/components/NewBadge'
import { ListingsVisitSession } from '@/components/ListingsVisitSession'
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

function formatPrice(cents: number | null, locale: string, callForPriceLabel: string): string {
  if (cents === null) return callForPriceLabel
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

function formatCondition(cond: string, cpoLabel: string): string {
  if (cond === 'certified_pre_owned') return cpoLabel
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

interface ListingCardProps {
  listing: ListingDoc
  locale: string
  t: {
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
}

function ListingCard({ listing: l, locale, t }: ListingCardProps) {
  const badges: string[] = []

  if (l.conversionType === 'rear_entry') badges.push(t.rearEntry)
  else if (l.conversionType === 'side_entry') badges.push(t.sideEntry)

  if (l.rampType === 'in_floor') badges.push(t.inFloorRamp)
  else if (l.rampType === 'fold_out') badges.push(t.foldOutRamp)
  else if (l.rampType === 'fold_in') badges.push(t.foldInRamp)

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
      <Link href={vehicleDetailPath(l.id)} className={styles.cardLink}>
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
            {formatPrice(l.priceCents, locale, t.callForPrice)}
          </span>
          {/* NewBadge renders only on the client after reading localStorage */}
          <NewBadge listedAt={l.listedAt} />
        </div>

        <div className={styles.cardBody}>
          <h2 className={styles.cardTitle}>{title}</h2>

          <p className={styles.cardMeta}>
            {mileage && <span className={styles.metaItem}>{mileage}</span>}
            {location && <span className={styles.metaItem}>{location}</span>}
            <span className={styles.metaItem}>{formatCondition(l.condition, t.cpo)}</span>
            {l.sellerType === 'private' && (
              <span className={styles.metaItem}>{t.privateSeller}</span>
            )}
          </p>

          {wavFeatures.length > 0 && (
            <ul className={styles.wavBadges} aria-label={t.wavFeaturesLabel}>
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

interface PaginationNavProps {
  pagination: Pagination
  currentParams: Record<string, string>
  prevLabel: string
  nextLabel: string
  pageOfLabel: (page: number, totalPages: number) => string
}

function PaginationNav({
  pagination,
  currentParams,
  prevLabel,
  nextLabel,
  pageOfLabel,
}: PaginationNavProps) {
  const { page, totalPages } = pagination

  const buildHref = (p: number) => {
    const params = new URLSearchParams(currentParams)
    params.set('page', String(p))
    return `/filters?${params.toString()}` as `/filters?${string}`
  }

  return (
    <nav aria-label="Pagination" className={styles.pagination}>
      {page > 1 ? (
        <Link href={buildHref(page - 1)} className={styles.paginationBtn}>
          {prevLabel}
        </Link>
      ) : (
        <span
          className={`${styles.paginationBtn} ${styles.paginationBtnDisabled}`}
          aria-disabled="true"
        >
          {prevLabel}
        </span>
      )}

      <span className={styles.paginationInfo} aria-current="page">
        {pageOfLabel(page, totalPages)}
      </span>

      {page < totalPages ? (
        <Link href={buildHref(page + 1)} className={styles.paginationBtn}>
          {nextLabel}
        </Link>
      ) : (
        <span
          className={`${styles.paginationBtn} ${styles.paginationBtnDisabled}`}
          aria-disabled="true"
        >
          {nextLabel}
        </span>
      )}
    </nav>
  )
}

// ── Page ─────────────────────────────────────────────────

interface ListingsPageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string>>
}

export default async function ListingsPage({ params: _params, searchParams }: ListingsPageProps) {
  const locale = await getLocale()
  const t = await getTranslations('FiltersPage')
  const listingT = {
    callForPrice: t('listing.callForPrice'),
    cpo: t('listing.cpo'),
    rearEntry: t('listing.rearEntry'),
    sideEntry: t('listing.sideEntry'),
    inFloorRamp: t('listing.inFloorRamp'),
    foldOutRamp: t('listing.foldOutRamp'),
    foldInRamp: t('listing.foldInRamp'),
    privateSeller: t('listing.privateSeller'),
    wavFeaturesLabel: t('listing.wavFeaturesLabel'),
  }

  const resolvedSearchParams = await searchParams
  const { data: listings, pagination } = await fetchListings(resolvedSearchParams)
  const hasConversionBrandFilter = Boolean(resolvedSearchParams.conversionBrand)

  return (
    <>
      <SiteHeader />

      <main id="main-content" className={styles.main}>
        <div className={styles.container}>

          <section className={styles.searchSection}>
            {/* Client components use useSearchParams — must be in Suspense */}
            <Suspense>
              <CategoryBarChart renderers={{ color: 'swatches', seller: 'donut', condition: 'donut' }} />
            </Suspense>
          </section>

          <section aria-label={t('searchResultsLabel')} className={styles.resultsSection}>
            <div className={styles.resultsHeader}>
              <p
                className={styles.resultsCount}
                aria-live="polite"
                aria-atomic="true"
              >
                {t('vehiclesFound', { count: pagination.total })}
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
                      <ListingCard listing={listing} locale={locale} t={listingT} />
                    </li>
                  ))}
                </ul>

                {pagination.totalPages > 1 && (
                  <PaginationNav
                    pagination={pagination}
                    currentParams={resolvedSearchParams}
                    prevLabel={t('pagination.previous')}
                    nextLabel={t('pagination.next')}
                    pageOfLabel={(page, totalPages) =>
                      t('pagination.pageOf', { page, totalPages })
                    }
                  />
                )}
              </ListingsVisitSession>
            ) : (
              <div className={styles.emptyState} role="status">
                <p>{hasConversionBrandFilter ? t('noVehiclesForBrand') : t('noVehicles')}</p>
                <Link href="/filters">{t('clearAllFilters')}</Link>
              </div>
            )}
          </section>

        </div>
      </main>
    </>
  )
}
