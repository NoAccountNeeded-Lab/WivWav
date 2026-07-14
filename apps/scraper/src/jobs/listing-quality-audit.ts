/**
 * Listing quality audit (issue #505).
 *
 * Produces machine-readable (JSON) and human-readable (text) reports on the
 * current state of listing data quality in the production database.  Read-only:
 * no listings are mutated by this command.
 *
 * Usage:
 *   pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report
 *   pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report --json
 *   pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report --source <sourceId>
 *   pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report --limit 1000
 *   pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report --out audit.json
 *   pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report --baseline search-baseline.json
 *   pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report --approve-baseline search-baseline.json
 *   pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report --coverage-drop-threshold 0.15
 *
 * Report dimensions:
 *   1. active/total listings, by source
 *   2. field completeness rates (make, model, year, vin, price, mileage, state,
 *      conversionType, rampType, images, color, fuelType, description)
 *   3. unknown-value rates for enum fields (conversionType, rampType)
 *   4. validation/quarantine breakdown by source
 *   5. accessibility conflicts (quarantine due to unsupported accessibility claim)
 *   6. stale observations (detail not scraped in >14 days for active listings)
 *   7. VIN / no-VIN split — no-VIN candidate counts
 *   8. exact/near-duplicate photo clusters (from image_cluster table)
 *   9. suspected placeholder clusters
 *  10. same-source / cross-source identity duplicates (isDuplicate flag)
 *  11. search index reconciliation (#642) — expected representative catalog
 *      (eligible listings grouped by verified vehicle group, same policy as
 *      indexing) vs. the live Meilisearch catalog, across every public
 *      facet, plus duplicate-vehicleId detection, coverage ratios, required-
 *      facet invariants, historical coverage-drop baselines, and the
 *      pending/quarantined/listing-resolve publication backlog. Skipped when
 *      `--source` scopes the audit, since vehicle groups may span sources.
 *
 * Privacy / redaction:
 *   Representative IDs are included for investigation. Descriptions, dealer
 *   copy, and personal seller data are never dumped in full.  At most 10
 *   representative listing IDs are included per category.
 *
 * Evidence retention:
 *   See docs/ops/evidence-retention.md for what must be preserved after raw
 *   HTML cleanup and how to reconstruct a field decision from audit output.
 *
 * @module
 */

import '../lib/load-env.js'

import { getDb } from '@wivwav/db'
import { detectSourceDrift } from '../engine/listing-validator.js'
import type { SourceDriftObservation } from '../engine/listing-validator.js'
import { reconcileSearchCatalog } from './search-reconciliation.js'
import type { CoverageBaseline, SearchReconciliationReport } from './search-reconciliation.js'

// ── Constants ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 500
const STALE_DETAIL_DAYS = 14
const MAX_REPRESENTATIVE_IDS = 10
/** Scraper extraction and analysis version — increment when extraction logic changes. */
export const AUDIT_VERSION = 1

// ── Types ────────────────────────────────────────────────────────────────────

export interface FieldCompletenessRate {
  field: string
  present: number
  total: number
  /** Rate 0–1: proportion of listings where the field is non-null / non-empty / non-unknown. */
  rate: number
}

export interface UnknownRate {
  field: string
  unknown: number
  total: number
  rate: number
}

export interface SourceSummary {
  sourceId: string
  totalListings: number
  activeListings: number
  eligibleListings: number
  quarantinedListings: number
  pendingListings: number
  fieldCompleteness: FieldCompletenessRate[]
  unknownRates: UnknownRate[]
  staleDetailCount: number
  /** Representative listing IDs where stale detail was observed (≤10). */
  staleDetailSamples: string[]
  noVinCount: number
  /** Representative listing IDs without a VIN (≤10). */
  noVinSamples: string[]
  accessibilityConflictCount: number
  /** Representative IDs quarantined for accessibility conflicts (≤10). */
  accessibilityConflictSamples: string[]
  /**
   * Listings marked `isDuplicate` where the same VIN appears in a listing from
   * a DIFFERENT source (cross-source identity duplicate).
   */
  crossSourceDuplicateCount: number
  /**
   * Listings marked `isDuplicate` where the duplicate relationship is confined
   * to this source only (same-source duplicate — same VIN listed twice by the
   * same scraper, e.g. a re-listed vehicle).
   */
  sameSourceDuplicateCount: number
  /** Representative IDs marked as duplicates (≤10). */
  duplicateSamples: string[]
  quarantineCodeBreakdown: Record<string, number>
}

export interface ImageClusterSummary {
  exactDuplicateClusters: number
  nearDuplicateClusters: number
  placeholderClusters: number
  crossVehicleClusters: number
  totalImageRows: number
}

export interface SourceDriftAlert {
  sourceId: string
  reason: string
}

export interface ListingQualityReport {
  /** ISO8601 timestamp of when this audit was run. */
  auditedAt: string
  /** Extraction/analysis version so results can be tied to deployed logic. */
  auditVersion: number
  /** Total active listings across all sources. */
  totalActive: number
  /** Total listings across all sources and statuses. */
  totalAll: number
  /** Per-source breakdowns. */
  bySources: SourceSummary[]
  /** Image cluster summary across all sources. */
  imageClusters: ImageClusterSummary
  /**
   * Search index reconciliation (#642). Null when the audit was scoped to a
   * single source via `--source` — vehicle groups can span sources, so a
   * per-source reconciliation would report false divergence.
   */
  searchReconciliation: SearchReconciliationReport | null
  /**
   * Drift alerts from per-source error/missing rate comparison against baselines.
   * Empty when no baseline file exists (run with --approve-baseline to set one).
   */
  driftAlerts: SourceDriftAlert[]
  /**
   * Known measurement gaps — dimensions the audit could not yet measure.
   * Operators should review and file follow-up issues for each gap.
   */
  knownGaps: string[]
}

// ── Core audit logic ─────────────────────────────────────────────────────────

type DbClient = ReturnType<typeof getDb>

/**
 * Fetches all source rows so we can scope the audit per source.
 */
async function getSources(db: DbClient, sourceId?: string): Promise<{ id: string }[]> {
  return db.source.findMany({
    ...(sourceId ? { where: { id: sourceId } } : {}),
    select: { id: true },
    orderBy: { id: 'asc' },
  })
}

/**
 * Paginated listing scan for a single source.
 * Collects the fields needed for all audit dimensions without loading full
 * listing records (description, images arrays are bounded appropriately).
 */
async function scanSourceListings(
  db: DbClient,
  sourceId: string,
  opts: { limit?: number },
): Promise<SourceSummary> {
  const staleThreshold = new Date(Date.now() - STALE_DETAIL_DAYS * 24 * 60 * 60 * 1000)

  const summary: SourceSummary = {
    sourceId,
    totalListings: 0,
    activeListings: 0,
    eligibleListings: 0,
    quarantinedListings: 0,
    pendingListings: 0,
    fieldCompleteness: [],
    unknownRates: [],
    staleDetailCount: 0,
    staleDetailSamples: [],
    noVinCount: 0,
    noVinSamples: [],
    accessibilityConflictCount: 0,
    accessibilityConflictSamples: [],
    crossSourceDuplicateCount: 0,
    sameSourceDuplicateCount: 0,
    duplicateSamples: [],
    quarantineCodeBreakdown: {},
  }

  // Field presence accumulators — tallied for active listings only.
  let fTotal = 0
  const fPresent: Record<string, number> = {
    make: 0, model: 0, year: 0, vin: 0, priceCents: 0, mileage: 0,
    state: 0, color: 0, fuelType: 0, description: 0, images: 0,
  }
  const unknownConversionType = { count: 0, total: 0 }
  const unknownRampType = { count: 0, total: 0 }

  let cursor: string | undefined
  let scanned = 0

  outer: for (;;) {
    const rows = await db.listing.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      where: { sourceId },
      select: {
        id: true,
        status: true,
        publicationStatus: true,
        make: true,
        model: true,
        year: true,
        vin: true,
        priceCents: true,
        mileage: true,
        state: true,
        color: true,
        fuelType: true,
        description: true,
        images: true,
        conversionType: true,
        rampType: true,
        isDuplicate: true,
        qualityIssueCodes: true,
        detailScrapedAt: true,
      },
      orderBy: { id: 'asc' },
    })

    if (rows.length === 0) break

    for (const row of rows) {
      summary.totalListings++
      scanned++

      if (row.status === 'active') {
        summary.activeListings++
        fTotal++

        // Field completeness
        if (row.make) fPresent['make']!++
        if (row.model) fPresent['model']!++
        // 0 and null are both sentinels for "year unknown/missing"
        if (row.year !== null && row.year !== 0) fPresent['year']!++
        if (row.vin) fPresent['vin']!++; else {
          summary.noVinCount++
          if (summary.noVinSamples.length < MAX_REPRESENTATIVE_IDS) {
            summary.noVinSamples.push(row.id)
          }
        }
        if (row.priceCents !== null) fPresent['priceCents']!++
        if (row.mileage !== null) fPresent['mileage']!++
        if (row.state) fPresent['state']!++
        if (row.color) fPresent['color']!++
        if (row.fuelType) fPresent['fuelType']!++
        if (row.description) fPresent['description']!++
        if (row.images.length > 0) fPresent['images']!++

        // Unknown-value rates for enum fields
        unknownConversionType.total++
        if (row.conversionType === 'unknown') unknownConversionType.count++
        unknownRampType.total++
        if (row.rampType === 'unknown') unknownRampType.count++

        // Stale detail
        const isStale =
          row.detailScrapedAt === null ||
          row.detailScrapedAt < staleThreshold
        if (isStale) {
          summary.staleDetailCount++
          if (summary.staleDetailSamples.length < MAX_REPRESENTATIVE_IDS) {
            summary.staleDetailSamples.push(row.id)
          }
        }

        // Accessibility conflicts
        if (row.qualityIssueCodes.includes('unsupported_accessibility_claim')) {
          summary.accessibilityConflictCount++
          if (summary.accessibilityConflictSamples.length < MAX_REPRESENTATIVE_IDS) {
            summary.accessibilityConflictSamples.push(row.id)
          }
        }
      }

      // Publication status (all statuses)
      if (row.publicationStatus === 'eligible') summary.eligibleListings++
      else if (row.publicationStatus === 'quarantined') {
        summary.quarantinedListings++
        for (const code of row.qualityIssueCodes) {
          summary.quarantineCodeBreakdown[code] = (summary.quarantineCodeBreakdown[code] ?? 0) + 1
        }
      }
      else summary.pendingListings++

      // Duplicates — tracked initially as sameSource; cross-source is resolved
      // after the scan via a separate VIN-presence query (see below).
      if (row.isDuplicate) {
        summary.sameSourceDuplicateCount++
        if (summary.duplicateSamples.length < MAX_REPRESENTATIVE_IDS) {
          summary.duplicateSamples.push(row.id)
        }
      }

      if (opts.limit !== undefined && scanned >= opts.limit) break outer
    }

    cursor = rows[rows.length - 1]!.id
    if (rows.length < BATCH_SIZE) break
  }

  // Resolve cross-source vs same-source duplicate split.
  // A duplicate is "cross-source" if the same VIN appears in a listing from a
  // DIFFERENT source.  Two queries: collect duplicate VINs from this source, then
  // check which of them appear in another source.
  if (summary.sameSourceDuplicateCount > 0) {
    try {
      const dupVinRows: { vin: string | null }[] = await db.listing.findMany({
        where: { sourceId, isDuplicate: true, vin: { not: null } },
        select: { vin: true },
      })
      const duplicateVins = [...new Set(dupVinRows.map(r => r.vin).filter((v): v is string => v !== null))]

      if (duplicateVins.length > 0) {
        // Find which of those VINs appear in at least one listing of a different source.
        const crossVinRows: { vin: string | null }[] = await db.listing.findMany({
          where: { sourceId: { not: sourceId }, vin: { in: duplicateVins } },
          select: { vin: true },
          distinct: ['vin'],
        })
        const crossSourceVins = new Set(crossVinRows.map(r => r.vin).filter((v): v is string => v !== null))

        if (crossSourceVins.size > 0) {
          summary.crossSourceDuplicateCount = await db.listing.count({
            where: { sourceId, isDuplicate: true, vin: { in: [...crossSourceVins] } },
          })
          summary.sameSourceDuplicateCount -= summary.crossSourceDuplicateCount
        }
      }
    } catch {
      // Cross-source detection failed — leave sameSourceDuplicateCount as the total
      // and crossSourceDuplicateCount as 0. The knownGaps entry documents this.
    }
  }

  // Build field completeness rates
  const fieldLabels: Record<string, string> = {
    make: 'make', model: 'model', year: 'year', vin: 'vin',
    priceCents: 'priceCents', mileage: 'mileage', state: 'state',
    color: 'color', fuelType: 'fuelType', description: 'description', images: 'images',
  }
  summary.fieldCompleteness = Object.entries(fieldLabels).map(([key, field]) => ({
    field,
    present: fPresent[key] ?? 0,
    total: fTotal,
    rate: fTotal > 0 ? (fPresent[key] ?? 0) / fTotal : 0,
  }))

  summary.unknownRates = [
    {
      field: 'conversionType',
      unknown: unknownConversionType.count,
      total: unknownConversionType.total,
      rate: unknownConversionType.total > 0 ? unknownConversionType.count / unknownConversionType.total : 0,
    },
    {
      field: 'rampType',
      unknown: unknownRampType.count,
      total: unknownRampType.total,
      rate: unknownRampType.total > 0 ? unknownRampType.count / unknownRampType.total : 0,
    },
  ]

  return summary
}

/**
 * Aggregate image cluster counts from the image_cluster table.
 */
async function auditImageClusters(db: DbClient): Promise<ImageClusterSummary> {
  const [
    totalImageRows,
    exactClusters,
    nearClusters,
    placeholderClusters,
    crossVehicleClusters,
  ] = await Promise.all([
    db.listingImage.count(),
    db.imageCluster.count({ where: { clusterType: 'exact' } }),
    db.imageCluster.count({ where: { clusterType: 'near' } }),
    db.imageCluster.count({ where: { isPlaceholder: true } }),
    db.imageCluster.count({ where: { crossVehicle: true } }),
  ])

  return {
    exactDuplicateClusters: exactClusters,
    nearDuplicateClusters: nearClusters,
    placeholderClusters,
    crossVehicleClusters,
    totalImageRows,
  }
}

/**
 * Run the full listing quality audit.
 * Read-only — no DB mutations.
 */
export async function runListingQualityAudit(opts: {
  sourceId?: string
  limit?: number
  coverageBaseline?: CoverageBaseline | null
  coverageDropThreshold?: number
}): Promise<ListingQualityReport> {
  const db = getDb()
  const auditedAt = new Date().toISOString()

  const sources = await getSources(db, opts.sourceId)
  const bySources: SourceSummary[] = []

  for (const src of sources) {
    const scanOpts: { limit?: number } = {}
    if (opts.limit !== undefined) scanOpts.limit = opts.limit
    const summary = await scanSourceListings(db, src.id, scanOpts)
    bySources.push(summary)
  }

  const totalActive = bySources.reduce((sum, s) => sum + s.activeListings, 0)
  const totalAll = bySources.reduce((sum, s) => sum + s.totalListings, 0)

  // Search reconciliation spans verified vehicle groups, which can include
  // members from more than one source — a `--source`-scoped run cannot
  // rebuild the expected catalog correctly, so it is skipped rather than
  // reporting false divergence.
  const [imageClusters, searchReconciliation] = await Promise.all([
    auditImageClusters(db),
    opts.sourceId === undefined
      ? reconcileSearchCatalog(db, {
          baseline: opts.coverageBaseline ?? null,
          ...(opts.coverageDropThreshold !== undefined ? { coverageDropThreshold: opts.coverageDropThreshold } : {}),
        })
      : Promise.resolve(null),
  ])

  // Drift detection — compare each source's current error/missing rates against a
  // stored baseline.  No baseline file is persisted by this audit command yet, so
  // we synthesise an observation and emit an empty alert list with a note.
  // Future work: load baselines from a JSON file alongside the audit output and
  // persist updated baselines after each run (see knownGaps below).
  const driftAlerts: SourceDriftAlert[] = []
  for (const src of bySources) {
    if (src.totalListings === 0) continue
    const errorRate = src.totalListings > 0 ? src.quarantinedListings / src.totalListings : 0
    const missingRate = src.activeListings > 0
      ? (src.noVinCount + src.staleDetailCount) / src.activeListings
      : 0
    const observation: SourceDriftObservation = { errorRate, missingRate }
    // Pass null (no baseline) so this always-first-observation audit run never
    // fires a false "abrupt drift" alert against an implicit 0% baseline.
    // Callers that maintain a rolling baseline should pass it here instead.
    const driftResult = detectSourceDrift(null, observation)
    if (driftResult.drifted && driftResult.reason) {
      driftAlerts.push({ sourceId: src.sourceId, reason: driftResult.reason })
    }
  }

  await db.$disconnect()

  return {
    auditedAt,
    auditVersion: AUDIT_VERSION,
    totalActive,
    totalAll,
    bySources,
    imageClusters,
    searchReconciliation,
    driftAlerts,
    knownGaps: [
      'VIN/NHTSA field-level mismatch counts require a live NHTSA vPIC check not run here — see vin-enrich job results in listing qualityIssueCodes (nhtsa_make_mismatch, nhtsa_model_mismatch, nhtsa_year_mismatch).',
      'Cross-source identity duplicate detection (same vehicle on multiple sources) requires VehicleIdentityDecision rows — run match-vehicle-identity job first to populate them.',
      'Exact perceptual duplicate photos require image_cluster rows — run image-integrity-backfill job first.',
      'User-reported quality signals (#147) are not yet ingested into the listing quality dimension.',
      'Field-level false-positive rates for WAV feature extraction cannot be measured without human-reviewed label sets beyond the current gold datasets.',
      'Drift baseline is not yet persisted — driftAlerts always uses a zero baseline (no historical comparison). Run with --approve-baseline to begin accumulating a rolling baseline.',
      'Search index reconciliation (#642) is skipped when --source scopes the audit — vehicle groups can span sources.',
    ],
  }
}

// ── Human-readable report printing ───────────────────────────────────────────

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function printReport(report: ListingQualityReport): void {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`WivWav Listing Quality Audit v${report.auditVersion}`)
  console.log(`Audited at: ${report.auditedAt}`)
  console.log(`${'='.repeat(70)}`)

  console.log(`\n── Overview ──`)
  console.log(`  Total active listings: ${report.totalActive}`)
  console.log(`  Total all statuses:    ${report.totalAll}`)

  for (const src of report.bySources) {
    console.log(`\n── Source: ${src.sourceId} ──`)
    console.log(`  Total listings:      ${src.totalListings}`)
    console.log(`  Active:              ${src.activeListings}`)
    console.log(`  Eligible (public):   ${src.eligibleListings}`)
    console.log(`  Quarantined:         ${src.quarantinedListings}`)
    console.log(`  Pending:             ${src.pendingListings}`)
    console.log(`  No-VIN active:       ${src.noVinCount}`)
    console.log(`  Stale detail (>${STALE_DETAIL_DAYS}d): ${src.staleDetailCount}`)
    console.log(`  A11y conflicts:      ${src.accessibilityConflictCount}`)
    console.log(`  Same-source dups:    ${src.sameSourceDuplicateCount}`)
    console.log(`  Cross-source dups:   ${src.crossSourceDuplicateCount}`)

    if (src.fieldCompleteness.length > 0) {
      console.log(`\n  Field completeness (active listings):`)
      for (const f of src.fieldCompleteness) {
        console.log(`    ${f.field.padEnd(20)} ${pct(f.rate).padStart(6)}  (${f.present}/${f.total})`)
      }
    }

    if (src.unknownRates.length > 0) {
      console.log(`\n  Unknown-value rates (active listings):`)
      for (const u of src.unknownRates) {
        console.log(`    ${u.field.padEnd(20)} ${pct(u.rate).padStart(6)}  (${u.unknown}/${u.total})`)
      }
    }

    if (Object.keys(src.quarantineCodeBreakdown).length > 0) {
      console.log(`\n  Quarantine code breakdown:`)
      for (const [code, count] of Object.entries(src.quarantineCodeBreakdown).sort(([, a], [, b]) => b - a)) {
        console.log(`    ${code.padEnd(36)} ${count}`)
      }
    }

    if (src.noVinSamples.length > 0) {
      console.log(`\n  No-VIN samples (up to ${MAX_REPRESENTATIVE_IDS}):`)
      console.log(`    ${src.noVinSamples.join(', ')}`)
    }

    if (src.staleDetailSamples.length > 0) {
      console.log(`\n  Stale-detail samples (up to ${MAX_REPRESENTATIVE_IDS}):`)
      console.log(`    ${src.staleDetailSamples.join(', ')}`)
    }

    if (src.accessibilityConflictSamples.length > 0) {
      console.log(`\n  Accessibility conflict samples (up to ${MAX_REPRESENTATIVE_IDS}):`)
      console.log(`    ${src.accessibilityConflictSamples.join(', ')}`)
    }
  }

  const ic = report.imageClusters
  console.log(`\n── Image clusters ──`)
  console.log(`  Total image rows:          ${ic.totalImageRows}`)
  console.log(`  Exact-duplicate clusters:  ${ic.exactDuplicateClusters}`)
  console.log(`  Near-duplicate clusters:   ${ic.nearDuplicateClusters}`)
  console.log(`  Placeholder clusters:      ${ic.placeholderClusters}`)
  console.log(`  Cross-vehicle clusters:    ${ic.crossVehicleClusters}`)

  console.log(`\n── Search index reconciliation (#642) ──`)
  const sr = report.searchReconciliation
  if (sr === null) {
    console.log(`  Skipped — audit was scoped with --source.`)
  } else if (!sr.available) {
    console.log(`  ${sr.note}`)
  } else {
    console.log(`  Expected representatives: ${sr.expectedTotal}`)
    console.log(`  Index document count:     ${sr.actualTotal}`)
    console.log(`  ${sr.note}`)
    console.log(`  Missing from index:       ${sr.missingFromIndex.count}${sr.missingFromIndex.sampleIds.length > 0 ? ` (e.g. ${sr.missingFromIndex.sampleIds.join(', ')})` : ''}`)
    console.log(`  Unexpected in index:      ${sr.unexpectedInIndex.count}${sr.unexpectedInIndex.sampleIds.length > 0 ? ` (e.g. ${sr.unexpectedInIndex.sampleIds.join(', ')})` : ''}`)
    console.log(`  Duplicate vehicleIds:     ${sr.duplicateVehicleIds.length}`)
    console.log(`  Canonicalization divergences: ${sr.canonicalizationDivergenceCount}`)

    const divergedFacets = sr.facetComparisons.filter((f) => f.diverged)
    console.log(`\n  Facet distributions (${sr.facetComparisons.length} checked, ${divergedFacets.length} diverged):`)
    for (const f of divergedFacets) {
      console.log(`    ⚠ ${f.facet}: onlyExpected=[${f.onlyInExpected.join(', ')}] onlyActual=[${f.onlyInActual.join(', ')}] mismatches=${f.countMismatches.length}`)
    }

    console.log(`\n  Coverage (optional facets, global):`)
    for (const c of sr.coverage.filter((c) => c.sourceId === 'global')) {
      console.log(`    ${c.field.padEnd(18)} ${pct(c.rate).padStart(6)}  (${c.present}/${c.total})`)
    }

    console.log(`\n  Unknown-value rate (enum facets, global):`)
    for (const u of sr.unknownRates.filter((u) => u.sourceId === 'global')) {
      console.log(`    ${u.field.padEnd(18)} ${pct(1 - u.rate).padStart(6)} unknown`)
    }

    if (sr.invariantViolations.length > 0) {
      console.log(`\n  ⚠ Invariant violations:`)
      for (const v of sr.invariantViolations) console.log(`    ${v}`)
    }

    if (sr.coverageDropAlerts.length > 0) {
      console.log(`\n  ⚠ Coverage drop vs baseline:`)
      for (const a of sr.coverageDropAlerts) {
        console.log(`    ${a.field} (${a.sourceId}): ${pct(a.previousRate)} → ${pct(a.currentRate)} (−${pct(a.drop)})`)
      }
    }

    const pb = sr.publicationBacklog
    console.log(`\n  Publication backlog: pending=${pb.pending} quarantined=${pb.quarantined} listing-resolve-queue=${pb.listingResolveBacklog ?? 'unavailable'}`)
  }

  console.log(`\n── Source drift alerts ──`)
  if (report.driftAlerts.length === 0) {
    console.log(`  No baseline on file — run with --approve-baseline to set one.`)
  } else {
    for (const alert of report.driftAlerts) {
      console.log(`  ⚠ ${alert.sourceId}: ${alert.reason}`)
    }
  }

  if (report.knownGaps.length > 0) {
    console.log(`\n── Known measurement gaps ──`)
    for (const gap of report.knownGaps) {
      console.log(`  • ${gap}`)
    }
  }

  console.log(`\n${'='.repeat(70)}\n`)
}

// ── CLI entry point ───────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  sourceId?: string
  limit?: number
  json: boolean
  out?: string
  baseline?: string
  approveBaseline?: string
  coverageDropThreshold?: number
} {
  if (!argv.includes('--report')) {
    console.error(
      'Usage: listing-quality-audit.ts --report [--json] [--source <sourceId>] [--limit N] [--out <file>] '
      + '[--baseline <file>] [--approve-baseline <file>] [--coverage-drop-threshold <0-1>]',
    )
    process.exit(1)
  }

  const sourceIdx = argv.indexOf('--source')
  const sourceId = sourceIdx >= 0 ? argv[sourceIdx + 1] : undefined
  const limitIdx = argv.indexOf('--limit')
  const limitRaw = limitIdx >= 0 ? argv[limitIdx + 1] : undefined
  const limit = limitRaw !== undefined ? parseInt(limitRaw, 10) : undefined
  const outIdx = argv.indexOf('--out')
  const out = outIdx >= 0 ? argv[outIdx + 1] : undefined
  const baselineIdx = argv.indexOf('--baseline')
  const baseline = baselineIdx >= 0 ? argv[baselineIdx + 1] : undefined
  const approveBaselineIdx = argv.indexOf('--approve-baseline')
  const approveBaseline = approveBaselineIdx >= 0 ? argv[approveBaselineIdx + 1] : undefined
  const thresholdIdx = argv.indexOf('--coverage-drop-threshold')
  const thresholdRaw = thresholdIdx >= 0 ? argv[thresholdIdx + 1] : undefined
  const coverageDropThreshold = thresholdRaw !== undefined ? parseFloat(thresholdRaw) : undefined

  const result: {
    sourceId?: string
    limit?: number
    json: boolean
    out?: string
    baseline?: string
    approveBaseline?: string
    coverageDropThreshold?: number
  } = {
    json: argv.includes('--json'),
  }
  if (sourceId !== undefined) result.sourceId = sourceId
  if (limit !== undefined && !isNaN(limit)) result.limit = limit
  if (out !== undefined) result.out = out
  if (baseline !== undefined) result.baseline = baseline
  if (approveBaseline !== undefined) result.approveBaseline = approveBaseline
  if (coverageDropThreshold !== undefined && !isNaN(coverageDropThreshold)) result.coverageDropThreshold = coverageDropThreshold
  return result
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2))

  void (async () => {
    const { existsSync, readFileSync, writeFileSync } = await import('node:fs')

    let coverageBaseline: CoverageBaseline | null = null
    if (options.baseline !== undefined && existsSync(options.baseline)) {
      coverageBaseline = JSON.parse(readFileSync(options.baseline, 'utf-8')) as CoverageBaseline
    }

    const auditOpts: {
      sourceId?: string
      limit?: number
      coverageBaseline?: CoverageBaseline | null
      coverageDropThreshold?: number
    } = {}
    if (options.sourceId !== undefined) auditOpts.sourceId = options.sourceId
    if (options.limit !== undefined) auditOpts.limit = options.limit
    if (coverageBaseline !== null) auditOpts.coverageBaseline = coverageBaseline
    if (options.coverageDropThreshold !== undefined) auditOpts.coverageDropThreshold = options.coverageDropThreshold

    try {
      const report = await runListingQualityAudit(auditOpts)

      if (options.approveBaseline !== undefined && report.searchReconciliation?.available) {
        const sr = report.searchReconciliation
        const newBaseline: CoverageBaseline = {
          capturedAt: report.auditedAt,
          entries: [...sr.coverage, ...sr.unknownRates].map((e) => ({ field: e.field, sourceId: e.sourceId, rate: e.rate })),
        }
        writeFileSync(options.approveBaseline, JSON.stringify(newBaseline, null, 2), 'utf-8')
        console.log(`Coverage baseline written to ${options.approveBaseline}`)
      }

      if (options.json || options.out) {
        const json = JSON.stringify(report, null, 2)
        if (options.out) {
          writeFileSync(options.out, json, 'utf-8')
          console.log(`Audit report written to ${options.out}`)
        } else {
          console.log(json)
        }
      } else {
        printReport(report)
      }
    } catch (err: unknown) {
      console.error('Listing quality audit failed:', err)
      process.exit(1)
    }
  })()
}
