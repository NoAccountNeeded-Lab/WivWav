import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import {
  ArrowDownFromLine,
  ArrowUpDown,
  Armchair,
  Building2,
  Car,
  ChevronLeft,
  DoorOpen,
  ExternalLink,
  Gauge,
  Globe,
  MapPin,
  MoveDown,
  Phone,
  ShieldCheck,
  Settings2,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { PhotoGallery } from '@/components/PhotoGallery'
import { Link } from '@/navigation'
import type { Translate } from '@/lib/intl'
import { toIntlLocale } from '@/lib/intl'
import { conditionLabel, rampLabel } from '../../listings/[id]/utils'
import { getServerApiBaseUrl } from '@/lib/api-url'
import { apiFetch } from '@/lib/api-fetch'
import styles from './page.module.css'

interface ListingDetail {
  id: string
  sourceUrl: string
  buyerUrl: string | null
  make: string
  model: string
  year: number
  trim: string | null
  vin: string | null
  condition: string
  sellerType: string
  priceCents: number | null
  mileage: number | null
  color: string | null
  fuelType: string | null
  transmission: string | null
  wav: {
    conversionType: string
    conversionManufacturer: string | null
    floorLoweringInches: number | null
    rampType: string
    conversionStatus: string
    wavFeatures: string[]
    wheelchairCapacity: number | null
  }
  location: {
    zip: string | null
    city: string | null
    state: string | null
    lat: number | null
    lng: number | null
  }
  dealer: {
    name: string | null
    phone: string | null
    website: string | null
  }
  images: string[]
  description: string | null
  listedAt: string
  sourceListedAt: string | null
  sourceUpdatedAt: string | null
}

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}): Promise<Metadata> {
  const { locale, id } = await params
  const t = await getTranslations({ locale, namespace: 'FilterDetail' })
  const detailT = await getTranslations({ locale, namespace: 'ListingDetail' })
  const listing = await getListing(id)
  if (!listing) return { title: t('notFoundTitle') }
  const title = `${listing.year} ${listing.make} ${listing.model}${listing.trim ? ` ${listing.trim}` : ''}`
  return {
    title: t('metaTitle', { title }),
    description: `${formatPrice(listing.priceCents, locale, detailT('callForPrice'))} · ${listing.location.city && listing.location.state ? `${listing.location.city}, ${listing.location.state} · ` : ''}${t('wavDescription')}`,
  }
}

function formatPrice(cents: number | null, locale: string, callForPrice: string): string {
  if (cents === null) return callForPrice
  return `$${(cents / 100).toLocaleString(toIntlLocale(locale))}`
}

function formatEnum(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(toIntlLocale(locale), { year: 'numeric', month: 'long', day: 'numeric' })
}

interface WavFeatureEntry {
  Icon: LucideIcon
  label: string
  detail?: string
}

const WAV_FEATURE_ICONS: Record<string, LucideIcon> = {
  has_lift:                ArrowUpDown,
  hand_controls:           Settings2,
  transfer_seat:           Armchair,
  kneel_system:            MoveDown,
  lowered_floor:           MoveDown,
  power_ramp:              ArrowDownFromLine,
  tie_down_system:         Users,
  automatic_door:          DoorOpen,
  motorized_running_board: Car,
}

function buildWavFeatures(
  listing: ListingDetail,
  t: Translate,
  listingT: Translate,
): WavFeatureEntry[] {
  const features: WavFeatureEntry[] = []
  const wav = listing.wav

  if (wav.conversionType !== 'unknown') {
    features.push({
      Icon: wav.conversionType === 'side_entry' ? Car : DoorOpen,
      label:
        wav.conversionType === 'side_entry'
          ? t('sideEntryConversion')
          : wav.conversionType === 'rear_entry'
            ? t('rearEntryConversion')
            : t('otherConversion', { type: formatEnum(wav.conversionType) }),
      ...(wav.conversionManufacturer ? { detail: wav.conversionManufacturer } : {}),
    })
  }

  if (wav.rampType !== 'unknown' && wav.rampType !== 'none') {
    features.push({ Icon: ArrowDownFromLine, label: rampLabel(wav.rampType, listingT) })
  }

  if (wav.floorLoweringInches !== null) {
    features.push({
      Icon: MoveDown,
      label: t('floorLowering'),
      detail: t('floorDrop', { inches: wav.floorLoweringInches }),
    })
  }

  for (const f of wav.wavFeatures) {
    const Icon = WAV_FEATURE_ICONS[f]
    if (Icon && listingT.has(`wavFeature_${f}`)) {
      features.push({ Icon, label: listingT(`wavFeature_${f}`) })
    }
  }

  if (wav.wheelchairCapacity !== null && wav.wheelchairCapacity > 0) {
    features.push({
      Icon: Users,
      label: t('wheelchairPositions'),
      detail: String(wav.wheelchairCapacity),
    })
  }

  return features
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'FilterDetail' })
  const listingT = await getTranslations({ locale, namespace: 'FiltersPage.listing' })
  const detailT = await getTranslations({ locale, namespace: 'ListingDetail' })
  const listing = await getListing(id)
  if (!listing) notFound()

  const vehicleTitle = `${listing.year} ${listing.make} ${listing.model}${listing.trim ? ` ${listing.trim}` : ''}`
  const loc = listing.location
  const dealer = listing.dealer
  const location = [loc.city, loc.state].filter(Boolean).join(', ')
  const wavFeatures = buildWavFeatures(listing, t, listingT)

  const vehicleSpecs = [
    listing.color ? { label: t('specs.color'), value: listing.color } : null,
    listing.fuelType ? { label: t('specs.fuelType'), value: listing.fuelType } : null,
    listing.transmission ? { label: t('specs.transmission'), value: listing.transmission } : null,
    listing.vin ? { label: t('specs.vin'), value: listing.vin } : null,
  ].filter((s): s is { label: string; value: string } => s !== null)

  const hasSeller = Boolean(location || dealer.name || dealer.phone || dealer.website)

  return (
    <main id="main-content" className={styles.page}>
      <Link href="/filters" className={styles.back}>
        <ChevronLeft size={16} aria-hidden />
        {t('back')}
      </Link>

      <div className={styles.galleryWrap}>
        <PhotoGallery images={listing.images} alt={vehicleTitle} />
      </div>

      <div className={styles.header}>
        <h1 className={styles.title}>{vehicleTitle}</h1>
        <div className={styles.price}>{formatPrice(listing.priceCents, locale, detailT('callForPrice'))}</div>
        {location && (
          <p className={styles.locationLine}>
            <MapPin size={14} aria-hidden />
            {location}
          </p>
        )}
      </div>

      <div className={styles.statsStrip} role="list" aria-label={t('statsLabel')}>
        <div className={styles.stat} role="listitem">
          <span className={styles.statValue}>{listing.year}</span>
          <span className={styles.statLabel}>{t('year')}</span>
        </div>
        {listing.mileage !== null && (
          <div className={styles.stat} role="listitem">
            <span className={styles.statValue}>{listing.mileage.toLocaleString(toIntlLocale(locale))}</span>
            <span className={styles.statLabel}>
              <Gauge size={11} aria-hidden /> {t('miles')}
            </span>
          </div>
        )}
        <div className={styles.stat} role="listitem">
          <span className={styles.statValue}>{conditionLabel(listing.condition, listingT)}</span>
          <span className={styles.statLabel}>{t('condition')}</span>
        </div>
        <div className={styles.stat} role="listitem">
          <span className={styles.statValue}>{listing.sellerType === 'dealer'
              ? t('sellerDealer')
              : listing.sellerType === 'private'
                ? t('sellerPrivate')
                : formatEnum(listing.sellerType)}</span>
          <span className={styles.statLabel}>{t('seller')}</span>
        </div>
      </div>

      {wavFeatures.length > 0 && (
        <section className={styles.section} aria-labelledby="wav-features-heading">
          <h2 className={styles.sectionTitle} id="wav-features-heading">{t('wavFeaturesHeading')}</h2>
          <ul className={styles.wavFeatures}>
            {wavFeatures.map(({ Icon, label, detail }) => (
              <li key={label} className={styles.wavFeature}>
                <Icon size={20} className={styles.wavIcon} aria-hidden />
                <div className={styles.wavText}>
                  <span className={styles.wavLabel}>{label}</span>
                  {detail && <span className={styles.wavDetail}>{detail}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {vehicleSpecs.length > 0 && (
        <section className={styles.section} aria-labelledby="vehicle-specs-heading">
          <h2 className={styles.sectionTitle} id="vehicle-specs-heading">{t('vehicleDetails')}</h2>
          <dl className={styles.specGrid}>
            {vehicleSpecs.map(({ label, value }) => (
              <div key={label} className={styles.specItem}>
                <dt className={styles.specLabel}>{label}</dt>
                <dd className={styles.specValue}>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {hasSeller && (
        <section className={styles.section} aria-labelledby="seller-heading">
          <h2 className={styles.sectionTitle} id="seller-heading">{t('sellerHeading')}</h2>
          <ul className={styles.sellerList}>
            {dealer.name && (
              <li className={styles.sellerRow}>
                <Building2 size={16} className={styles.sellerIcon} aria-hidden />
                <span>{dealer.name}</span>
              </li>
            )}
            {location && (
              <li className={styles.sellerRow}>
                <MapPin size={16} className={styles.sellerIcon} aria-hidden />
                <span>{location}{loc.zip ? ` ${loc.zip}` : ''}</span>
              </li>
            )}
            {dealer.phone && (
              <li className={styles.sellerRow}>
                <Phone size={16} className={styles.sellerIcon} aria-hidden />
                <a href={`tel:${dealer.phone}`} className={styles.sellerLink}>{dealer.phone}</a>
              </li>
            )}
            {dealer.website && (
              <li className={styles.sellerRow}>
                <Globe size={16} className={styles.sellerIcon} aria-hidden />
                <a href={dealer.website} target="_blank" rel="noopener noreferrer" className={styles.sellerLink}>
                  {dealer.website.replace(/^https?:\/\//, '')}
                </a>
              </li>
            )}
          </ul>
        </section>
      )}

      {listing.description && (
        <section className={styles.section} aria-labelledby="description-heading">
          <h2 className={styles.sectionTitle} id="description-heading">{t('description')}</h2>
          <p className={styles.description}>{listing.description}</p>
        </section>
      )}

      {listing.vin && (
        <Link href={`/vin/${encodeURIComponent(listing.vin)}`} className={styles.secondaryCta}>
          <ShieldCheck size={16} aria-hidden />
          {t('viewSafetyReport')}
        </Link>
      )}

      <a href={listing.buyerUrl ?? listing.sourceUrl} target="_blank" rel="noopener noreferrer" className={styles.cta}>
        <ExternalLink size={16} aria-hidden />
        {listing.sellerType === 'private' ? t('contactSeller') : t('viewSellerListing')}
      </a>

      <p className={styles.meta}>
        {listing.sourceListedAt != null
          ? t('sourceListed', { date: formatDate(listing.sourceListedAt, locale) })
          : t('firstSaw', { date: formatDate(listing.listedAt, locale) })}
        {listing.sourceUpdatedAt != null
          ? t('sourceUpdated', { date: formatDate(listing.sourceUpdatedAt, locale) })
          : ''}
      </p>
    </main>
  )
}
