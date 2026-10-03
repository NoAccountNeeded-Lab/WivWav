import { AlertTriangle, DoorOpen, ExternalLink, ShieldCheck, Truck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Translate } from '@/lib/intl'
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

function conversionTypeLabel(value: string, t: Translate): string | null {
  if (value === 'side_entry') return t('entryTypeSide')
  if (value === 'rear_entry') return t('entryTypeRear')
  return null
}

/** `t` is the `FiltersPage.listing` translator. */
function rampTypeLabel(value: string, t: Translate): string | null {
  if (value === 'in_floor') return t('inFloorRamp')
  if (value === 'fold_out') return t('foldOutRamp')
  if (value === 'fold_in') return t('foldInRamp')
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
  const t = useTranslations('WavConversionInfo')
  const listingT = useTranslations('FiltersPage.listing')
  const commonT = useTranslations('Common')
  const isSide = conversionType === 'side_entry'
  const isRear = conversionType === 'rear_entry'
  const hasType = isSide || isRear
  const isConflicting = conversionTypeStatus === 'conflicting'
  const displayName = conversionBrand?.name ?? conversionManufacturer
  const productSpecs = [
    matchedProduct ? conversionTypeLabel(matchedProduct.conversionType, t) : null,
    matchedProduct ? rampTypeLabel(matchedProduct.rampType, listingT) : null,
    matchedProduct?.floorLoweringInches != null
      ? t('loweredFloor', { inches: matchedProduct.floorLoweringInches })
      : null,
  ].filter(Boolean)

  return (
    <>
      {(displayName || conversionBrand) && (
        <section className={styles.conversionSection} aria-labelledby="conversion-heading">
          <div className={styles.sectionHeader}>
            <h2 id="conversion-heading" className={styles.sectionTitle}>
              {t('title')}
            </h2>
            {conversionBrand?.nmedaCertified && (
              <span className={styles.nmedaBadge}>
                <ShieldCheck size={13} aria-hidden />
                {t('nmeda')}
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
                  {conversionBrand ? t('brand') : t('manufacturer')}
                </div>
              </div>
            </div>
          )}

          {matchedProduct && (
            <div className={styles.productBox}>
              <div className={styles.productLabel}>{t('matchedProduct')}</div>
              <div className={styles.productName}>{matchedProduct.name}</div>
              {productSpecs.length > 0 && (
                <ul className={styles.specList} aria-label={t('specsLabel')}>
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
              {t('brandWebsite')}
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
              {isSide ? t('sideEntry') : t('rearEntry')}
            </div>
            <div className={styles.entrySub}>
              {isSide ? t('sideAccess') : t('rearAccess')}
            </div>
          </div>
        </div>
      )}

      {isConflicting && (
        <div className={styles.needsVerificationBanner} role="note" aria-label={t('needsVerification')}>
          <span className={styles.needsVerificationIcon} aria-hidden>
            <AlertTriangle size={20} />
          </span>
          <div>
            <div className={styles.needsVerificationLabel}>{t('needsVerification')}</div>
            <div className={styles.needsVerificationSub}>
              {t('conflictingInfo')}
              {sourceUrl ? (
                <>
                  {' — '}
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className={styles.needsVerificationLink}>
                    {t('checkOriginal')}
                    <ExternalLink size={11} aria-hidden />
                    <span className="sr-only"> {commonT('openInNewTab')}</span>
                  </a>
                </>
              ) : (
                t('confirmWithSeller')
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
