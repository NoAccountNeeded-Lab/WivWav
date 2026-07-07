'use client'

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Phone, ShieldCheck, X } from 'lucide-react'
import type { NmeaDealer } from '@/app/listings/[id]/types'
import styles from './NmedaDealersNearby.module.css'

interface NmedaDealersNearbyProps {
  dealers: NmeaDealer[]
  /** Whether the listing had coordinates to perform the search. */
  hasCoordinates: boolean
}

function formatDistance(miles: number | null): string {
  if (miles === null) return ''
  if (miles < 1) return '< 1 mi'
  return `${miles} mi`
}

function DealerCard({ dealer }: { dealer: NmeaDealer }) {
  const location = [dealer.city, dealer.state].filter(Boolean).join(', ')

  return (
    <li className={styles.dealerCard}>
      <div className={styles.dealerHeader}>
        <span className={styles.dealerName}>{dealer.name}</span>
        {dealer.qapCertified && (
          <span className={styles.qapBadge}>
            <ShieldCheck size={11} aria-hidden />
            <span>QAP certified</span>
          </span>
        )}
      </div>
      {(location || dealer.distanceMiles !== null) && (
        <div className={styles.dealerMeta}>
          {location && <span>{location}</span>}
          {dealer.distanceMiles !== null && (
            <span className={styles.distance}>{formatDistance(dealer.distanceMiles)}</span>
          )}
        </div>
      )}
      <div className={styles.dealerActions}>
        {dealer.phone && (
          <a
            href={`tel:${dealer.phone.replace(/[^+\d]/g, '')}`}
            className={styles.dealerAction}
            aria-label={`Call ${dealer.name}`}
          >
            <Phone size={12} aria-hidden />
            {dealer.phone}
          </a>
        )}
        {dealer.website && (
          <a
            href={dealer.website}
            target="_blank"
            rel="noreferrer"
            className={styles.dealerAction}
            aria-label={`Visit ${dealer.name} website (opens in new tab)`}
          >
            <ExternalLink size={12} aria-hidden />
            Website
          </a>
        )}
      </div>
    </li>
  )
}

interface DealerModalProps {
  dealers: NmeaDealer[]
  onClose: () => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
}

function DealerModal({ dealers, onClose, triggerRef }: DealerModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // Move focus to close button when modal opens
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  // Return focus to trigger when modal closes
  useEffect(() => {
    return () => {
      triggerRef.current?.focus()
    }
  }, [triggerRef])

  // Handle Escape key and focus trap
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose()
      return
    }

    if (e.key !== 'Tab') return

    const modal = modalRef.current
    if (!modal) return

    const focusable = Array.from(
      modal.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
  }

  return (
    // The dialog element owns onKeyDown itself so it can implement its own
    // Escape-to-close and focus-trap behavior; onClick's backdrop-click-close
    // is a pointer-only convenience that Escape already covers for keyboard
    // users, so this is a deliberate, already-accessible use of both handlers.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-label="All NMEDA certified dealers nearby"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={handleKeyDown}
      ref={modalRef}
    >
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Certified Dealers Nearby</h3>
          <button
            ref={closeRef}
            type="button"
            className={styles.modalClose}
            aria-label="Close dealer list"
            onClick={onClose}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <ul className={styles.dealerList} aria-label="All nearby NMEDA certified dealers">
          {dealers.map((d) => (
            <DealerCard key={d.id} dealer={d} />
          ))}
        </ul>
        <p className={styles.modalFooter}>
          <a
            href="https://www.nmeda.com/find-a-dealer/"
            target="_blank"
            rel="noreferrer"
            className={styles.fallbackLink}
          >
            Full directory at nmeda.com
            <ExternalLink size={11} aria-hidden />
          </a>
        </p>
      </div>
    </div>
  )
}

export function NmedaDealersNearby({ dealers, hasCoordinates }: NmedaDealersNearbyProps) {
  const [showAll, setShowAll] = useState(false)
  const viewAllRef = useRef<HTMLButtonElement>(null)

  // Section is hidden (not broken) when listing has no coordinates
  if (!hasCoordinates) return null

  const preview = dealers.slice(0, 3)
  const hasMore = dealers.length > 3

  return (
    <section className={styles.section} aria-labelledby="nmeda-dealers-heading">
      <div className={styles.sectionHeader}>
        <h2 id="nmeda-dealers-heading" className={styles.sectionTitle}>
          Certified Dealers Nearby
        </h2>
      </div>

      {dealers.length === 0 ? (
        <p className={styles.fallback}>
          No certified dealers found nearby.{' '}
          <a
            href="https://www.nmeda.com/find-a-dealer/"
            target="_blank"
            rel="noreferrer"
            className={styles.fallbackLink}
          >
            Find a dealer at nmeda.com
            <ExternalLink size={11} aria-hidden />
          </a>
        </p>
      ) : (
        <>
          <ul className={styles.dealerList}>
            {preview.map((d) => (
              <DealerCard key={d.id} dealer={d} />
            ))}
          </ul>

          {hasMore && (
            <button
              ref={viewAllRef}
              type="button"
              className={styles.viewAllBtn}
              onClick={() => setShowAll(true)}
              aria-haspopup="dialog"
            >
              View all {dealers.length} dealers
            </button>
          )}
        </>
      )}

      {showAll && (
        <DealerModal
          dealers={dealers}
          onClose={() => setShowAll(false)}
          triggerRef={viewAllRef}
        />
      )}
    </section>
  )
}
