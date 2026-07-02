import { MileageGauge } from '@/components/listing/MileageGauge'
import { deriveListingSpecs } from '@/components/listing/vehicleSpecs'
import type { ListingDetail, ModelMsrp, ModelResearch, ModelResearchSource, VehicleStats } from './types'
import { deriveShowVehicleStats, deriveVisibleVehicleStats } from './vehicleTabUtils'
import styles from './tabs.module.css'

interface VehicleTabProps {
  listing: ListingDetail
  modelResearch: ModelResearch | null
  vehicleStats: VehicleStats | null
  modelMsrp: ModelMsrp | null
  bodyType: string | null
}

/** Format cents as a currency string for MSRP display. */
function formatMsrp(cents: number, currency: string): string {
  const dollars = cents / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(dollars)
  } catch {
    return `$${dollars.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  }
}

/** Human-readable label for each research claim field. */
const CLAIM_LABELS: Record<string, string> = {
  fuelEconomyCity: 'Fuel economy (city)',
  fuelEconomyHwy: 'Fuel economy (hwy)',
  fuelEconomyCombined: 'Fuel economy (combined)',
  engineDescription: 'Engine',
  drivetrain: 'Drivetrain',
  fuelType: 'Fuel type',
  transmission: 'Transmission',
}

/** Fields shown in the model facts section (ordered). */
const RESEARCH_FIELD_ORDER = [
  'engineDescription',
  'drivetrain',
  'fuelEconomyCombined',
  'fuelEconomyCity',
  'fuelEconomyHwy',
  'fuelType',
  'transmission',
]

export function VehicleTab({
  listing,
  modelResearch,
  vehicleStats,
  modelMsrp,
  bodyType,
}: VehicleTabProps) {
  // Build a map from sourceId → source for inline citation links
  const sourceMap = new Map<string, ModelResearchSource>(
    (modelResearch?.sources ?? []).map((s) => [s.id, s]),
  )

  // Deduplicate: pick the first claim per field in display order
  const researchClaims = RESEARCH_FIELD_ORDER.flatMap((field) => {
    const claim = modelResearch?.claims.find((c) => c.field === field)
    return claim ? [claim] : []
  })

  const researchedFields = new Set(researchClaims.map((c) => c.field))
  const listingSpecs = deriveListingSpecs(listing, bodyType, researchedFields)
  const visibleStats = deriveVisibleVehicleStats(vehicleStats)
  const showVehicleStats = deriveShowVehicleStats(vehicleStats)

  return (
    <div className={styles.tabContent}>
      {listing.mileage !== null && (
        <div className={styles.section}>
          <h3 className={styles.sectionLabel}>Mileage &amp; lifespan</h3>
          <MileageGauge mileage={listing.mileage} make={listing.make} />
        </div>
      )}

      {/* Model facts — cited from EPA / NHTSA */}
      {researchClaims.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionLabel}>Base model facts</h3>
          <dl className={styles.specList}>
            {researchClaims.map((claim) => {
              const src = claim.sourceId ? sourceMap.get(claim.sourceId) : undefined
              return (
                <div key={claim.id} className={styles.specRow}>
                  <dt className={styles.specLabel}>{CLAIM_LABELS[claim.field] ?? claim.field}</dt>
                  <dd className={styles.specValueCited}>
                    {claim.claimText}
                    {src && (
                      <a
                        href={src.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.citationLink}
                      >
                        {src.sourceName}
                        <span className="sr-only"> (opens in new tab)</span>
                      </a>
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
        </div>
      )}

      {showVehicleStats && vehicleStats && (
        <div className={styles.section}>
          <h3 className={styles.sectionLabel}>Reliability &amp; lifespan sources</h3>
          {visibleStats.length > 0 && (
            <dl className={styles.specList}>
              {visibleStats.map((stat) => (
                <SpecRow key={stat.label} label={stat.label} value={stat.value} />
              ))}
            </dl>
          )}
          {vehicleStats.methodology && (
            <p className={styles.sourceMethodology}>{vehicleStats.methodology}</p>
          )}
          {vehicleStats.sources.length > 0 && (
            <ul className={styles.sourceList} aria-label="Vehicle stats sources">
              {vehicleStats.sources.map((source) => (
                <li key={source.url}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.citationLink}
                  >
                    {source.name}
                    <span className="sr-only"> (opens in new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Original MSRP — model-level, source-backed */}
      {modelMsrp?.originalMsrpCents != null && (
        <div className={styles.section}>
          <h3 className={styles.sectionLabel}>Original MSRP</h3>
          <dl className={styles.specList}>
            <div className={styles.specRow}>
              <dt className={styles.specLabel}>Base MSRP</dt>
              <dd className={styles.specValueCited}>
                {formatMsrp(modelMsrp.originalMsrpCents, modelMsrp.currency)}
                <a
                  href={modelMsrp.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.citationLink}
                >
                  {modelMsrp.source.name}
                  <span className="sr-only"> (opens in new tab)</span>
                </a>
              </dd>
            </div>
            {modelMsrp.destinationFeeCents != null && (
              <div className={styles.specRow}>
                <dt className={styles.specLabel}>Destination fee</dt>
                <dd className={styles.specValue}>
                  {formatMsrp(modelMsrp.destinationFeeCents, modelMsrp.currency)}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* Specs table — listing-level data */}
      <div className={styles.section}>
        <h3 className={styles.sectionLabel}>Listing specifications</h3>
        <dl className={styles.specList}>
          {listingSpecs.map((spec) => (
            <SpecRow key={spec.label} label={spec.label} value={spec.value} mono={spec.mono === true} />
          ))}
        </dl>
      </div>
    </div>
  )
}

function SpecRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.specRow}>
      <dt className={styles.specLabel}>{label}</dt>
      <dd className={mono ? styles.specValueMono : styles.specValue}>{value}</dd>
    </div>
  )
}
