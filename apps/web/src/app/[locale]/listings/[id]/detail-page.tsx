import type { Metadata } from 'next'
import type { VinHistoryResponse, VinHistoryEntry } from '@wivwav/types'
import { Accessibility, Gauge, ShieldCheck, TrendingUp, Info } from 'lucide-react'
import { notFound } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import { getServerApiBaseUrl, getPublicApiBaseUrl } from '@/lib/api-url'
import { apiFetch } from '@/lib/api-fetch'
import { PhotoGallery } from '@/components/PhotoGallery'
import { buildPhotoEvidence } from '@/components/photo-evidence'
import {
  conversionBrandSlug,
  matchConversionProduct,
  type ConversionBrandDetail,
} from '@/components/listing/conversionBrand'
import { BackButton } from './BackButton'
import { ListingSheet } from './ListingSheet'
import { OverviewTab } from './OverviewTab'
import { WavTab } from './WavTab'
import { VehicleTab } from './VehicleTab'
import { MarketTab } from './MarketTab'
import { SafetyTab } from './SafetyTab'
import type {
  ConversionHistoryEntry,
  DealerProfile,
  DealerReview,
  ListingDetail,
  MarketPricing,
  ModelMsrp,
  ModelResearch,
  NmeaDealer,
  PricePoint,
  SafetyData,
  SimilarListing,
  VehicleStats,
} from './types'
import { conditionLabel, formatPrice } from './utils'
import styles from './page.module.css'

// ── Data fetchers ──────────────────────────────────────────────────────────

async function getListing(id: string): Promise<ListingDetail | null> {
  try {
    const res = await apiFetch(`${getServerApiBaseUrl()}/v1/listings/${id}`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data: ListingDetail }
    return json.data
  } catch {
    return null
  }
}

async function getConversionBrand(
  conversionManufacturer: string | null,
): Promise<ConversionBrandDetail | null> {
  const slug = conversionBrandSlug(conversionManufacturer)
  if (!slug) return null

  try {
    const res = await apiFetch(`${getServerApiBaseUrl()}/v1/conversion-brands/${slug}`, {
      next: { revalidate: 86400 },
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data: ConversionBrandDetail }
    return json.data
  } catch {
    return null
  }
}

async function getPriceHistory(id: string): Promise<PricePoint[]> {
  try {
    const res = await apiFetch(`${getServerApiBaseUrl()}/v1/listings/${id}/price-history`, {
      next: { revalidate: 300 },
    })
    if (!res.ok) return []
    const json = (await res.json()) as { data: PricePoint[] }
    return json.data ?? []
  } catch {
    return []
  }
}

async function getConversionHistory(id: string): Promise<ConversionHistoryEntry[]> {
  try {
    const res = await apiFetch(`${getServerApiBaseUrl()}/v1/listings/${id}/conversion-history`, {
      next: { revalidate: 300 },
    })
    if (!res.ok) return []
    const json = (await res.json()) as { data: ConversionHistoryEntry[] }
    return json.data ?? []
  } catch {
    return []
  }
}

async function getVinHistory(vin: string | null): Promise<VinHistoryEntry[]> {
  if (vin === null) return []

  try {
    const res = await apiFetch(`${getServerApiBaseUrl()}/v1/vin/${encodeURIComponent(vin)}/history`, {
      next: { revalidate: 300 },
    })
    if (!res.ok) return []
    const json = (await res.json()) as { data: VinHistoryResponse }
    return json.data.history ?? []
  } catch {
    return []
  }
}

async function getSafety(id: string): Promise<SafetyData | null> {
  try {
    const res = await apiFetch(`${getServerApiBaseUrl()}/v1/listings/${id}/safety`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data: SafetyData }
    return json.data
  } catch {
    return null
  }
}

async function getMarketPricing(
  make: string,
  model: string,
  year: number,
): Promise<MarketPricing | null> {
  try {
    const url = new URL(`${getServerApiBaseUrl()}/v1/market/pricing`)
    url.searchParams.set('make', make)
    url.searchParams.set('model', model)
    url.searchParams.set('year', String(year))
    const res = await apiFetch(url.toString(), { next: { revalidate: 3600 } })
    if (!res.ok) return null
    const json = (await res.json()) as { data: MarketPricing }
    return json.data
  } catch {
    return null
  }
}

async function getModelResearch(
  make: string,
  model: string,
  year: number,
): Promise<ModelResearch | null> {
  try {
    const res = await apiFetch(
      `${getServerApiBaseUrl()}/v1/vehicles/${encodeURIComponent(make)}/${encodeURIComponent(model)}/${year}/research`,
      { next: { revalidate: 86400 } },
    )
    if (!res.ok) return null
    const json = (await res.json()) as { data: ModelResearch | null }
    return json.data
  } catch {
    return null
  }
}

async function getVehicleStats(
  make: string,
  model: string,
  year: number,
): Promise<VehicleStats | null> {
  try {
    const url = new URL(
      `${getServerApiBaseUrl()}/v1/vehicles/${encodeURIComponent(make)}/${encodeURIComponent(model)}/stats`,
    )
    url.searchParams.set('year', String(year))
    const res = await apiFetch(url.toString(), { next: { revalidate: 86400 } })
    if (!res.ok) return null
    const json = (await res.json()) as { data: VehicleStats | null }
    return json.data
  } catch {
    return null
  }
}

async function getModelMsrp(
  make: string,
  model: string,
  year: number,
): Promise<ModelMsrp | null> {
  try {
    const res = await apiFetch(
      `${getServerApiBaseUrl()}/v1/vehicles/${encodeURIComponent(make)}/${encodeURIComponent(model)}/${year}/msrp`,
      { next: { revalidate: 86400 } },
    )
    if (!res.ok) return null
    const json = (await res.json()) as { data: ModelMsrp | null }
    return json.data
  } catch {
    return null
  }
}

async function getSimilar(
  make: string,
  model: string,
  year: number,
  excludeId: string,
): Promise<SimilarListing[]> {
  try {
    const url = new URL(`${getServerApiBaseUrl()}/v1/listings`)
    url.searchParams.set('make', make)
    url.searchParams.set('model', model)
    url.searchParams.set('yearMin', String(year - 2))
    url.searchParams.set('yearMax', String(year + 2))
    url.searchParams.set('perPage', '5')
    const res = await apiFetch(url.toString(), { next: { revalidate: 300 } })
    if (!res.ok) return []
    const json = (await res.json()) as { data: SimilarListing[] }
    return (json.data ?? []).filter((l) => l.id !== excludeId).slice(0, 3)
  } catch {
    return []
  }
}

async function getNearbyDealers(
  lat: number | null,
  lng: number | null,
): Promise<NmeaDealer[]> {
  if (lat === null || lng === null) return []
  try {
    const url = new URL(`${getServerApiBaseUrl()}/v1/nmea-dealers`)
    url.searchParams.set('lat', String(lat))
    url.searchParams.set('lng', String(lng))
    const res = await apiFetch(url.toString(), { next: { revalidate: 86400 } })
    if (!res.ok) return []
    const json = (await res.json()) as { data: NmeaDealer[] }
    return json.data ?? []
  } catch {
    return []
  }
}

async function getDealerProfile(id: string): Promise<DealerProfile | null> {
  try {
    const res = await apiFetch(`${getServerApiBaseUrl()}/v1/listings/${id}/dealer`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data: { dealerProfile: DealerProfile | null } }
    return json.data.dealerProfile
  } catch {
    return null
  }
}

async function getDealerReviews(dealerId: string): Promise<DealerReview[]> {
  try {
    const url = new URL(`${getServerApiBaseUrl()}/v1/dealers/${dealerId}/reviews`)
    url.searchParams.set('take', '5')
    const res = await apiFetch(url.toString(), { next: { revalidate: 3600 } })
    if (!res.ok) return []
    const json = (await res.json()) as { data: { reviews: DealerReview[] } }
    return json.data.reviews ?? []
  } catch {
    return []
  }
}

// ── Metadata ───────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const locale = await getLocale()
  const t = await getTranslations('ListingDetail')
  const listing = await getListing(id)
  if (!listing) return { title: t('listingNotFound') }
  const title = `${listing.year} ${listing.make} ${listing.model}${listing.trim ? ` ${listing.trim}` : ''}`
  const locationStr = listing.location.city && listing.location.state
    ? `${listing.location.city}, ${listing.location.state} · `
    : ''
  return {
    title: `${title} — WivWav`,
    description: `${formatPrice(listing.priceCents, locale)} · ${locationStr}Wheelchair accessible vehicle`,
  }
}

// ── Page ───────────────────────────────────────────────────────────────────

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { id } = await params
  const locale = await getLocale()
  const listing = await getListing(id)
  if (!listing) notFound()

  const [
    priceHistory,
    safety,
    marketPricing,
    similar,
    modelResearch,
    vehicleStats,
    modelMsrp,
    conversionBrand,
    nearbyDealers,
    dealerProfile,
    conversionHistory,
    vinHistory,
  ] =
    await Promise.all([
      getPriceHistory(id),
      getSafety(id),
      getMarketPricing(listing.make, listing.model, listing.year),
      getSimilar(listing.make, listing.model, listing.year, id),
      getModelResearch(listing.make, listing.model, listing.year),
      getVehicleStats(listing.make, listing.model, listing.year),
      getModelMsrp(listing.make, listing.model, listing.year),
      getConversionBrand(listing.wav.conversionManufacturer),
      getNearbyDealers(listing.location.lat, listing.location.lng),
      getDealerProfile(id),
      getConversionHistory(id),
      getVinHistory(listing.vin),
    ])
  // Reviews depend on the dealer profile's id, resolved above — a
  // private-seller listing or an unmatched dealer has none to fetch.
  const dealerReviews = dealerProfile ? await getDealerReviews(dealerProfile.id) : []

  const vehicleTitle = `${listing.year} ${listing.make} ${listing.model}${listing.trim ? ` ${listing.trim}` : ''}`
  const photoEvidence = buildPhotoEvidence(listing.images, listing.semanticEvidence)
  const location = [listing.location.city, listing.location.state].filter(Boolean).join(', ')
  const matchedConversionProduct = conversionBrand
    ? matchConversionProduct(conversionBrand.products, {
        make: listing.make,
        model: listing.model,
        conversionType: listing.wav.conversionType,
        rampType: listing.wav.rampType,
      })
    : null

  const openRecallCount = (safety?.recalls ?? []).filter((r) => r.status === 'open').length

  const tabs = [
    {
      id: 'wav',
      label: 'WAV',
      icon: <Accessibility size={14} aria-hidden />,
      content: (
        <WavTab
          listing={listing}
          conversionBrand={conversionBrand}
          matchedConversionProduct={matchedConversionProduct}
          nearbyDealers={nearbyDealers}
          hasCoordinates={listing.location.lat !== null && listing.location.lng !== null}
          conversionHistory={conversionHistory}
        />
      ),
    },
    {
      id: 'vehicle',
      label: 'Vehicle',
      icon: <Gauge size={14} aria-hidden />,
      content: (
        <VehicleTab
          listing={listing}
          modelResearch={modelResearch}
          vehicleStats={vehicleStats}
          modelMsrp={modelMsrp}
          bodyType={safety?.vehicleModel?.bodyType ?? null}
        />
      ),
    },
    {
      id: 'overview',
      label: 'Overview',
      icon: <Info size={14} aria-hidden />,
      content: (
        <OverviewTab
          listing={listing}
          priceHistory={priceHistory}
          apiBaseUrl={getPublicApiBaseUrl()}
          dealerProfile={dealerProfile}
          dealerReviews={dealerReviews}
        />
      ),
    },
    {
      id: 'market',
      label: 'Market',
      icon: <TrendingUp size={14} aria-hidden />,
      content: (
        <MarketTab
          listing={listing}
          marketPricing={marketPricing}
          priceHistory={priceHistory}
          vinHistory={vinHistory}
          similar={similar}
          modelMsrp={modelMsrp}
          vehiclePathPrefix={`/${locale}`}
        />
      ),
    },
    {
      id: 'safety',
      label: openRecallCount > 0 ? `Safety (${openRecallCount})` : 'Safety',
      icon: <ShieldCheck size={14} aria-hidden />,
      content: <SafetyTab listing={listing} safety={safety} apiBaseUrl={getPublicApiBaseUrl()} />,
    },
  ]

  return (
    <main id="main-content" className={styles.page}>
      {/* Header — vehicle identity */}
      <header className={styles.header}>
        <BackButton />
        <div className={styles.headerText}>
          <h1 className={styles.headerTitle}>{vehicleTitle}</h1>
          <p className={styles.headerMeta}>
            <span className={styles.headerPrice}>{formatPrice(listing.priceCents, locale)}</span>
            {listing.condition && (
              <span className={styles.headerDot}>{conditionLabel(listing.condition)}</span>
            )}
            {location && <span className={styles.headerDot}>{location}</span>}
          </p>
        </div>
      </header>

      {/* Photo gallery — swipeable, contains full car */}
      <div className={styles.galleryWrap}>
        <PhotoGallery
          images={listing.images}
          alt={vehicleTitle}
          className={styles.gallery}
          viewportClassName={styles.galleryViewport}
          imageClassName={styles.galleryImage}
          dotsClassName={styles.galleryDots}
          showExpand={false}
          imageAlts={photoEvidence.imageAlts}
          imageCategories={photoEvidence.imageCategories}
          categoryLabels={photoEvidence.categoryLabels}
        />
      </div>

      {/* Spacer so gallery doesn't hide under the sheet peek */}
      <div className={styles.sheetSpacer} aria-hidden />

      {/* Bottom sheet with tabs (wrapper gives wide-screen grid a stable target) */}
      <div className={styles.sheetWrap}>
        <ListingSheet tabs={tabs} />
      </div>
    </main>
  )
}
