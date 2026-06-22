import { DollarSign, ExternalLink, Globe, MapPin, Phone } from 'lucide-react'
import type { ListingDealer, ListingLocation } from '@wivwav/types'
import styles from './DealerCard.module.css'

interface DealerCardProps {
  dealer: ListingDealer
  location: Pick<ListingLocation, 'city' | 'state' | 'zip'>
  sellerType: string
  listingUrl?: string | null
  priceLabel?: string | null
}

export function DealerCard({ dealer, location, sellerType, listingUrl, priceLabel }: DealerCardProps) {
  const locationStr = [location.city, location.state].filter(Boolean).join(', ')

  return (
    <div>
      <div className={styles.header}>
        <h3 className={styles.name}>{dealer.name ?? 'Dealer'}</h3>
        <div className={styles.type}>
          {sellerType === 'dealer' ? 'Dealership' : 'Private seller'}
        </div>
      </div>

      <ul className={styles.contactList}>
        {locationStr && (
          <li className={styles.contactRow}>
            <MapPin size={16} className={styles.contactIcon} aria-hidden />
            <span className="sr-only">Location: </span>
            {locationStr}
            {location.zip ? ` ${location.zip}` : ''}
          </li>
        )}
        {priceLabel && (
          <li className={styles.contactRow}>
            <DollarSign size={16} className={styles.contactIcon} aria-hidden />
            <span>{priceLabel}</span>
          </li>
        )}
        {dealer.phone && (
          <li className={styles.contactRow}>
            <Phone size={16} className={styles.contactIcon} aria-hidden />
            <a href={`tel:${dealer.phone}`} className={styles.link}>
              {dealer.phone}
            </a>
          </li>
        )}
        {dealer.website && (
          <li className={styles.contactRow}>
            <Globe size={16} className={styles.contactIcon} aria-hidden />
            <a
              href={/^https?:\/\//.test(dealer.website) ? dealer.website : `https://${dealer.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              {dealer.website.replace(/^https?:\/\//, '')}
            </a>
          </li>
        )}
        {listingUrl && (
          <li className={styles.contactRow}>
            <ExternalLink size={16} className={styles.contactIcon} aria-hidden />
            <a
              href={listingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.listingLink}
            >
              View listing
              <span className="sr-only"> (opens in new tab)</span>
            </a>
          </li>
        )}
      </ul>
    </div>
  )
}
