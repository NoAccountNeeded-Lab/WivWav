import Link from 'next/link'
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
import { PhotoGallery } from '@/components/PhotoGallery'
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

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const listing = await getListing(id)
  if (!listing) return { title: 'Listing not found' }
  const title = `${listing.year} ${listing.make} ${listing.model}${listing.trim ? ` ${listing.trim}` : ''}`
  return {
    title: `${title} — WivWav`,
    description: `${formatPrice(listing.priceCents)} · ${listing.location.city && listing.location.state ? `${listing.location.city}, ${listing.location.state} · ` : ''}Wheelchair accessible vehicle`,
  }
}

function formatPrice(cents: number | null): string {
  if (cents === null) return 'Call for price'
  return `$${(cents / 100).toLocaleString()}`
}

function formatEnum(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
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

function buildWavFeatures(listing: ListingDetail): WavFeatureEntry[] {
  const features: WavFeatureEntry[] = []
  const wav = listing.wav

  if (wav.conversionType !== 'unknown') {
    features.push({
      Icon: wav.conversionType === 'side_entry' ? Car : DoorOpen,
      label: `${formatEnum(wav.conversionType)} Conversion`,
      ...(wav.conversionManufacturer ? { detail: wav.conversionManufacturer } : {}),
    })
  }

  if (wav.rampType !== 'unknown' && wav.rampType !== 'none') {
    features.push({ Icon: ArrowDownFromLine, label: `${formatEnum(wav.rampType)} Ramp` })
  }

  if (wav.floorLoweringInches !== null) {
    features.push({
      Icon: MoveDown,
      label: 'Floor Lowering',
      detail: `${wav.floorLoweringInches}" drop`,
    })
  }

  for (const f of wav.wavFeatures) {
    const Icon = WAV_FEATURE_ICONS[f]
    const label = WAV_FEATURE_LABELS[f]
    if (Icon && label) features.push({ Icon, label })
  }

  if (wav.wheelchairCapacity !== null && wav.wheelchairCapacity > 0) {
    features.push({
      Icon: Users,
      label: 'Wheelchair Positions',
      detail: String(wav.wheelchairCapacity),
    })
  }

  return features
}

export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const listing = await getListing(id)
  if (!listing) notFound()

  const vehicleTitle = `${listing.year} ${listing.make} ${listing.model}${listing.trim ? ` ${listing.trim}` : ''}`
  const loc = listing.location
  const dealer = listing.dealer
  const location = [loc.city, loc.state].filter(Boolean).join(', ')
  const wavFeatures = buildWavFeatures(listing)

  const vehicleSpecs = [
    listing.color ? { label: 'Color', value: listing.color } : null,
    listing.fuelType ? { label: 'Fuel type', value: listing.fuelType } : null,
    listing.transmission ? { label: 'Transmission', value: listing.transmission } : null,
    listing.vin ? { label: 'VIN', value: listing.vin } : null,
  ].filter((s): s is { label: string; value: string } => s !== null)

  const hasSeller = Boolean(location || dealer.name || dealer.phone || dealer.website)

  return (
    <main id="main-content" className={styles.page}>
      <Link href="/filters" className={styles.back}>
        <ChevronLeft size={16} aria-hidden />
        Back to listings
      </Link>

      <div className={styles.galleryWrap}>
        <PhotoGallery images={listing.images} alt={vehicleTitle} />
      </div>

      <div className={styles.header}>
        <h1 className={styles.title}>{vehicleTitle}</h1>
        <div className={styles.price}>{formatPrice(listing.priceCents)}</div>
        {location && (
          <p className={styles.locationLine}>
            <MapPin size={14} aria-hidden />
            {location}
          </p>
        )}
      </div>

      <div className={styles.statsStrip} role="list" aria-label="Key vehicle stats">
        <div className={styles.stat} role="listitem">
          <span className={styles.statValue}>{listing.year}</span>
          <span className={styles.statLabel}>Year</span>
        </div>
        {listing.mileage !== null && (
          <div className={styles.stat} role="listitem">
            <span className={styles.statValue}>{listing.mileage.toLocaleString()}</span>
            <span className={styles.statLabel}>
              <Gauge size={11} aria-hidden /> Miles
            </span>
          </div>
        )}
        <div className={styles.stat} role="listitem">
          <span className={styles.statValue}>{formatEnum(listing.condition)}</span>
          <span className={styles.statLabel}>Condition</span>
        </div>
        <div className={styles.stat} role="listitem">
          <span className={styles.statValue}>{formatEnum(listing.sellerType)}</span>
          <span className={styles.statLabel}>Seller</span>
        </div>
      </div>

      {wavFeatures.length > 0 && (
        <section className={styles.section} aria-labelledby="wav-features-heading">
          <h2 className={styles.sectionTitle} id="wav-features-heading">WAV Features</h2>
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
          <h2 className={styles.sectionTitle} id="vehicle-specs-heading">Vehicle details</h2>
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
          <h2 className={styles.sectionTitle} id="seller-heading">Seller</h2>
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
          <h2 className={styles.sectionTitle} id="description-heading">Description</h2>
          <p className={styles.description}>{listing.description}</p>
        </section>
      )}

      {listing.vin && (
        <Link href={`/vin/${encodeURIComponent(listing.vin)}`} className={styles.secondaryCta}>
          <ShieldCheck size={16} aria-hidden />
          View safety report
        </Link>
      )}

      <a href={listing.buyerUrl ?? listing.sourceUrl} target="_blank" rel="noopener noreferrer" className={styles.cta}>
        <ExternalLink size={16} aria-hidden />
        {listing.sellerType === 'private' ? 'Contact seller' : 'View seller listing'}
      </a>

      <p className={styles.meta}>Listed {formatDate(listing.listedAt)}</p>
    </main>
  )
}
