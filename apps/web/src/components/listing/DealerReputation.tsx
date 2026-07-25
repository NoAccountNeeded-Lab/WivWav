import { Star } from 'lucide-react'
import type { DealerProfile, DealerReview } from '@/app/[locale]/listings/[id]/types'
import styles from './DealerReputation.module.css'

interface DealerReputationProps {
  dealerProfile: DealerProfile
  reviews: DealerReview[]
  /** Wraps the whole section — pass the host tab's `.section` class so spacing matches sibling sections. */
  sectionClassName?: string | undefined
  /** Applied to the "Reviews" heading — pass the host tab's `.sectionLabel` class. */
  sectionLabelClassName?: string | undefined
}

const MAX_SNIPPET_LENGTH = 220

/**
 * Raw `opening_hours` JSON from Google Places — #103's dealer-enrich job
 * stores it verbatim, and its shape varies by API version, so every field
 * here is optional and must be read defensively.
 */
interface PlacesOpeningHours {
  open_now?: boolean | undefined
  weekday_text?: string[] | undefined
}

function parseHours(hours: unknown): PlacesOpeningHours | null {
  if (hours === null || typeof hours !== 'object' || Array.isArray(hours)) return null
  const raw = hours as Record<string, unknown>
  const weekdayText = Array.isArray(raw.weekday_text)
    ? raw.weekday_text.filter((line): line is string => typeof line === 'string')
    : undefined
  const openNow = typeof raw.open_now === 'boolean' ? raw.open_now : undefined
  if (openNow === undefined && (weekdayText === undefined || weekdayText.length === 0)) return null
  return { open_now: openNow, weekday_text: weekdayText }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max).trimEnd()}…`
}

function formatReviewDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function sourceLabel(source: string): string {
  if (source === 'google') return 'via Google'
  return `via ${source.charAt(0).toUpperCase()}${source.slice(1)}`
}

function StarRow({ rating, size = 14 }: { rating: number; size?: number }) {
  const stars = [1, 2, 3, 4, 5]
  return (
    <span className={styles.starRow} role="img" aria-label={`${rating} out of 5 stars`}>
      {stars.map((n) => (
        <Star
          key={n}
          size={size}
          aria-hidden
          className={n <= Math.round(rating) ? styles.starFilled : styles.starEmpty}
        />
      ))}
    </span>
  )
}

export function DealerReputation({
  dealerProfile,
  reviews,
  sectionClassName,
  sectionLabelClassName,
}: DealerReputationProps) {
  const { rating, reviewCount } = dealerProfile
  const hours = parseHours(dealerProfile.hours)
  const hasRating = rating !== null && reviewCount !== null && reviewCount > 0

  if (!hasRating && reviews.length === 0 && hours === null) return null

  return (
    <div className={sectionClassName}>
      {sectionLabelClassName && <h3 className={sectionLabelClassName}>Reviews</h3>}
      <div className={styles.wrap}>
        {hasRating && rating !== null && (
          <div className={styles.summary}>
            <StarRow rating={rating} size={16} />
            <span className={styles.ratingValue}>{rating.toFixed(1)}</span>
            <span className={styles.reviewCount}>
              ({reviewCount} review{reviewCount === 1 ? '' : 's'})
            </span>
          </div>
        )}

        {hours !== null && hours.open_now !== undefined && (
          <div className={hours.open_now ? styles.openBadge : styles.closedBadge}>
            {hours.open_now ? 'Open now' : 'Closed now'}
          </div>
        )}

        {hours !== null && hours.weekday_text && hours.weekday_text.length > 0 && (
          <ul className={styles.hoursList}>
            {hours.weekday_text.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        {reviews.length > 0 && (
          <ul className={styles.reviewList}>
            {reviews.map((review) => (
              <li key={review.id} className={styles.reviewCard}>
                <div className={styles.reviewHeader}>
                  <span className={styles.reviewAuthor}>{review.authorName}</span>
                  <StarRow rating={review.rating} size={12} />
                </div>
                <p className={styles.reviewText}>{truncate(review.text, MAX_SNIPPET_LENGTH)}</p>
                <div className={styles.reviewMeta}>
                  <span>{formatReviewDate(review.publishedAt)}</span>
                  <span aria-hidden>·</span>
                  <span>{sourceLabel(review.source)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
