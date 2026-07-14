import Link from 'next/link'
import {
  AlertTriangle,
  ExternalLink,
  Gauge,
  MapPin,
  Settings2,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { DealerCard } from '@/components/listing/DealerCard'
import { ProvenanceBadge } from '@/components/listing/ProvenanceBadge'
import { ListingDisclaimer } from '@/components/listing/ListingDisclaimer'
import { ReportListingForm } from './ReportListingForm'
import {
  conditionLabel,
  daysListed,
  estimateMonthly,
  formatDate,
  formatPrice,
} from './utils'
import {
  formatVerificationDate,
  getVerificationTimestamp,
  isVerificationStale,
} from './verificationUtils'
import type { ListingDetail, PricePoint } from './types'
import styles from './tabs.module.css'

interface OverviewTabProps {
  listing: ListingDetail
  priceHistory: PricePoint[]
  apiBaseUrl: string
}

export function OverviewTab({ listing, priceHistory, apiBaseUrl }: OverviewTabProps) {
  const days = daysListed(listing.listedAt)
  const firstPoint = priceHistory.length >= 2 ? priceHistory[0] : undefined
  const lastPoint = priceHistory.length >= 2 ? priceHistory[priceHistory.length - 1] : undefined
  const priceDrop = firstPoint && lastPoint ? firstPoint.priceCents - lastPoint.priceCents : null
  const hasDealerInfo = listing.dealer.name ?? listing.dealer.phone ?? listing.dealer.website
  const crossListings = listing.crossListings ?? []

  const verificationTimestamp = getVerificationTimestamp(listing.provenance)
  const verificationDateLabel = formatVerificationDate(verificationTimestamp)
  const isStale = isVerificationStale(verificationTimestamp)

  const sourceLink = listing.buyerUrl ?? listing.sourceUrl
  const sourceName = listing.provenance?.sourceName ?? 'source'

  return (
    <div className={styles.tabContent}>
      {/* Verification banner */}
      <div className={styles.verificationBanner} role="note" aria-label="Listing verification status">
        {verificationDateLabel !== null ? (
          <>
            <span>Last verified {verificationDateLabel}</span>
            {isStale && (
              <span className={styles.verificationStaleWarning}>
                <AlertTriangle size={12} aria-hidden />
                {' '}Listing may be outdated — verify with the seller
              </span>
            )}
          </>
        ) : (
          <span className={styles.verificationStaleWarning}>
            <AlertTriangle size={12} aria-hidden />
            {' '}Verification date unavailable — confirm with the seller
          </span>
        )}
      </div>

      {listing.reportSummary?.flagged && (
        <div className={styles.reportWarning} role="note" aria-label="Data accuracy warning">
          <AlertTriangle size={14} aria-hidden />
          <span>Data accuracy flagged by users</span>
        </div>
      )}

      {/* Price block */}
      <div className={styles.priceBlock}>
        <div className={styles.price}>{formatPrice(listing.priceCents)}</div>
        {listing.priceCents !== null && (
          <div className={styles.priceMo}>
            Est. ${estimateMonthly(listing.priceCents).toLocaleString()}/mo
          </div>
        )}
        {priceDrop !== null && priceDrop > 0 && lastPoint && (
          <div className={styles.priceDrop}>
            <TrendingDown size={12} aria-hidden />
            Reduced ${(priceDrop / 100).toLocaleString()} on {formatDate(lastPoint.recordedAt)}
          </div>
        )}
      </div>

      {/* Condition + days pills */}
      <div className={styles.pills}>
        <span className={styles.conditionPill}>{conditionLabel(listing.condition)}</span>
        <span className={styles.daysPill}>
          {days === 0 ? 'Listed today' : `${days} day${days === 1 ? '' : 's'} listed`}
        </span>
      </div>

      {/* Specs chips */}
      <div className={styles.chips}>
        {listing.mileage !== null && (
          <span className={styles.chip}>
            <Gauge size={11} aria-hidden />
            {listing.mileage.toLocaleString()} mi
          </span>
        )}
        {listing.transmission && (
          <span className={styles.chip}>
            <Settings2 size={11} aria-hidden />
            {listing.transmission}
          </span>
        )}
        {listing.fuelType && (
          <span className={styles.chip}>
            <TrendingUp size={11} aria-hidden />
            {listing.fuelType}
          </span>
        )}
        {listing.color && (
          <span className={styles.chip}>
            <span aria-hidden>◆</span>
            {listing.color}
          </span>
        )}
        {([listing.location.city, listing.location.state].filter(Boolean).length > 0) && (
          <span className={styles.chip}>
            <MapPin size={11} aria-hidden />
            {[listing.location.city, listing.location.state].filter(Boolean).join(', ')}
          </span>
        )}
      </div>

      {/* CTAs */}
      <div className={styles.ctaWrap}>
        <a
          href={sourceLink}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.ctaPrimary}
        >
          <ExternalLink size={16} aria-hidden />
          {listing.sellerType === 'private' ? 'Contact seller' : 'View seller listing'}
        </a>
        {listing.vin && (
          <Link href={`/vin/${encodeURIComponent(listing.vin)}`} className={styles.ctaSecondary}>
            <ShieldCheck size={16} aria-hidden />
            View safety report
          </Link>
        )}
      </div>

      <ReportListingForm listingId={listing.id} apiBaseUrl={apiBaseUrl} />

      {/* Seller description snippet — capped at 300 chars by the API; source link directs to full copy */}
      {listing.description && (
        <div className={styles.section}>
          <h3 className={styles.sectionLabel}>From the listing</h3>
          <p className={styles.descriptionSnippet}>{listing.description}</p>
          <a
            href={sourceLink}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.descriptionSourceLink}
          >
            <ExternalLink size={11} aria-hidden />
            View full listing on {sourceName}
            <span className="sr-only"> (opens in new tab)</span>
          </a>
        </div>
      )}

      {/* Dealer info */}
      {hasDealerInfo && (
        <div className={styles.section}>
          <DealerCard
            dealer={listing.dealer}
            location={listing.location}
            sellerType={listing.sellerType}
            listingUrl={sourceLink}
          />
        </div>
      )}

      {crossListings.length > 0 && (
        <section className={styles.section} aria-labelledby="also-available-at">
          <h3 id="also-available-at" className={styles.sectionLabel}>Also available at</h3>
          <div className={styles.alternateDealers}>
            {crossListings.map((crossListing) => (
              <DealerCard
                key={crossListing.id}
                dealer={crossListing.dealer}
                location={crossListing.location}
                sellerType={crossListing.sellerType}
                listingUrl={crossListing.buyerUrl ?? crossListing.sourceUrl}
                priceLabel={formatPrice(crossListing.priceCents)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Provenance + disclaimer — near decision-impacting data */}
      <div className={styles.section}>
        <ProvenanceBadge provenance={listing.provenance} />
        <ListingDisclaimer />
      </div>

      <p className={styles.footerMeta}>
        Listed {formatDate(listing.listedAt)} · Updated {formatDate(listing.updatedAt)}
      </p>
    </div>
  )
}
