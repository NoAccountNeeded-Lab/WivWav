import { AlertTriangle, DoorOpen, ExternalLink, ShieldCheck, Truck } from 'lucide-react'
import type { FieldResolutionState } from '@wivwav/types'
import { abbreviate } from '@/app/[locale]/listings/[id]/utils'
import type { ConversionBrandDetail, ConversionProduct } from './conversionBrand'
import styles from './WavConversionInfo.module.css'

interface WavConversionInfoProps {
  conversionType: string
  conversionManufacturer?: string | null
  conversionBrand?: ConversionBrandDetail | null | undefined
  matchedProduct?: ConversionProduct | null | undefined
  /**
   * #499 field-resolution status for `conversionType`. When `'conflicting'`,
   * the source disagrees with itself (e.g. category text vs. description
   * text, or a credible photo claim) — `conversionType` itself already reads
   * `'unknown'` in that case (the API forces it), so this is the only signal
   * that distinguishes "no evidence" from "evidence disagrees" for the UI.
   */
  conversionTypeStatus?: FieldResolutionState | undefined
  /** Outbound link shown in the "needs verification" state — never internal evidence/claim text. */
  sourceUrl?: string | null | undefined
}

function conversionTypeLabel(value: string): string | null {
  if (value === 'side_entry') return 'Side entry'
  if (value === 'rear_entry') return 'Rear entry'
  return null
}

function rampTypeLabel(value: string): string | null {
  if (value === 'in_floor') return 'In-floor ramp'
  if (value === 'fold_out') return 'Fold-out ramp'
  if (value === 'fold_in') return 'Fold-in ramp'
  return null
}

export function WavConversionInfo({
  conversionType,
  conversionManufacturer,
  conversionBrand,
  matchedProduct,
  conversionTypeStatus,
  sourceUrl,
}: WavConversionInfoProps) {
  const isSide = conversionType === 'side_entry'
  const isRear = conversionType === 'rear_entry'
  const hasType = isSide || isRear
  const isConflicting = conversionTypeStatus === 'conflicting'
  const displayName = conversionBrand?.name ?? conversionManufacturer
  const productSpecs = [
    matchedProduct ? conversionTypeLabel(matchedProduct.conversionType) : null,
    matchedProduct ? rampTypeLabel(matchedProduct.rampType) : null,
    matchedProduct?.floorLoweringInches != null
      ? `${matchedProduct.floorLoweringInches} inch lowered floor`
      : null,
  ].filter(Boolean)

  return (
    <>
      {(displayName || conversionBrand) && (
        <section className={styles.conversionSection} aria-labelledby="conversion-heading">
          <div className={styles.sectionHeader}>
            <h2 id="conversion-heading" className={styles.sectionTitle}>
              Conversion
            </h2>
            {conversionBrand?.nmedaCertified && (
              <span className={styles.nmedaBadge}>
                <ShieldCheck size={13} aria-hidden />
                NMEDA QAP
              </span>
            )}
          </div>

          {displayName && (
            <div className={styles.convRow}>
              <div className={styles.convLogo} aria-hidden>
                {abbreviate(displayName)}
              </div>
              <div className={styles.convBody}>
                <div className={styles.convName}>{displayName}</div>
                <div className={styles.convSub}>
                  {conversionBrand ? 'WAV conversion brand' : 'WAV conversion manufacturer'}
                </div>
              </div>
            </div>
          )}

          {matchedProduct && (
            <div className={styles.productBox}>
              <div className={styles.productLabel}>Matched product</div>
              <div className={styles.productName}>{matchedProduct.name}</div>
              {productSpecs.length > 0 && (
                <ul className={styles.specList} aria-label="Conversion product specs">
                  {productSpecs.map((spec) => (
                    <li key={spec}>{spec}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {conversionBrand?.website && (
            <a
              className={styles.websiteLink}
              href={conversionBrand.website}
              target="_blank"
              rel="noreferrer"
            >
              Brand website
              <ExternalLink size={13} aria-hidden />
            </a>
          )}
        </section>
      )}

      {hasType && (
        <div className={styles.entryBanner}>
          <span className={styles.entryIcon} aria-hidden>
            {isSide ? <DoorOpen size={22} /> : <Truck size={22} />}
          </span>
          <div>
            <div className={styles.entryLabel}>
              {isSide ? 'Side-entry conversion' : 'Rear-entry conversion'}
            </div>
            <div className={styles.entrySub}>
              {isSide ? 'Driver or passenger side access' : 'Rear ramp or lift access'}
            </div>
          </div>
        </div>
      )}

      {isConflicting && (
        <div className={styles.needsVerificationBanner} role="note" aria-label="Entry type needs verification">
          <span className={styles.needsVerificationIcon} aria-hidden>
            <AlertTriangle size={20} />
          </span>
          <div>
            <div className={styles.needsVerificationLabel}>Entry type needs verification</div>
            <div className={styles.needsVerificationSub}>
              The listing source has conflicting information about side vs. rear entry
              {sourceUrl ? (
                <>
                  {' — '}
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className={styles.needsVerificationLink}>
                    check the original listing
                    <ExternalLink size={11} aria-hidden />
                    <span className="sr-only"> (opens in new tab)</span>
                  </a>
                </>
              ) : (
                '. Confirm with the seller before purchase.'
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
