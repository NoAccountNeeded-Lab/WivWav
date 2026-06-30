/**
 * Vehicle identity backfill (issue #532).
 *
 * Before enabling non-VIN auto-linking (#529) in production, this backfill
 * runs the matcher over existing active listings so operators can review
 * candidate counts, confidence/rule distributions, and a sample of likely
 * false positives — without persisting any decisions.
 *
 * Usage:
 *   pnpm tsx apps/scraper/src/jobs/vehicle-identity-backfill.ts --report
 *   pnpm tsx apps/scraper/src/jobs/vehicle-identity-backfill.ts --apply
 *   pnpm tsx apps/scraper/src/jobs/vehicle-identity-backfill.ts --apply --source <sourceId>
 *
 * Always run --report first and review the output before --apply.
 *
 * Deployment procedure:
 * 1. Run: pnpm tsx apps/scraper/src/jobs/vehicle-identity-backfill.ts --report
 *    Review output — confirm the auto-link and candidate rates look plausible.
 *    A high auto-link rate on one source may indicate a data problem (e.g. many
 *    listings sharing a stock number or source URL) rather than genuine
 *    duplicates. Review the false-positive sample before applying.
 * 2. Roll out per-source for phased enablement:
 *    pnpm tsx apps/scraper/src/jobs/vehicle-identity-backfill.ts --apply --source <sourceId>
 *    Watch the operator listing and vehicle views after each source.
 * 3. Apply to all sources once each per-source run looks clean:
 *    pnpm tsx apps/scraper/src/jobs/vehicle-identity-backfill.ts --apply
 * 4. Trigger a Meilisearch re-index (meilisearch-sync job) if listings were
 *    merged so the search index reflects updated vehicle groupings.
 * 5. Post-release smoke check:
 *    - Confirm auto-linked counts match --report totals.
 *    - Spot-check 5-10 auto-linked pairs against their source pages.
 *    - Verify representative listing selection (#530) shows a clean result
 *      for each auto-linked vehicle group.
 *    - Confirm candidate decisions (--report: candidate count) are visible to
 *      operator review tools and were not written in report mode.
 *
 * Rollback:
 * - --apply is idempotent. Running it again with unchanged data is safe.
 * - To revert auto-linked decisions made in a run window, set
 *   vehicleIdentityDecision.state to 'rejected' (does not destroy listing
 *   source data) and clear vehicleId on the affected listings:
 *
 *   UPDATE vehicle_identity_decision
 *     SET state = 'rejected'
 *   WHERE decided_at >= '<run-start>' AND decided_at < '<run-end>'
 *     AND state = 'verified';
 *
 *   UPDATE listings
 *     SET vehicle_id = NULL
 *   WHERE vehicle_id IN (
 *     SELECT vehicle_id FROM vehicle_identity_decision
 *     WHERE decided_at >= '<run-start>' AND decided_at < '<run-end>'
 *       AND state = 'rejected'
 *   );
 *
 *   Then re-sync affected listings (meilisearch-sync or syncListings call).
 * - Source observations, listing rows, and vehicle rows are left in place.
 *   Only the decision state and vehicleId assignments are reverted.
 *
 * @module
 */

import { getDb, upsertVehicleIdentityDecision, VehicleIdentityDecisionState } from '@wivwav/db'
import type { Listing } from '@wivwav/db'
import { matchListingPair, type MatchableListing, type VehicleIdentityMatchResult } from '../engine/vehicle-identity-matcher.js'

const BATCH_SIZE = 500

/** The number of borderline candidates to include in the false-positive sample. */
const FALSE_POSITIVE_SAMPLE_SIZE = 10

export interface VehicleIdentityBackfillReport {
  totalListingsAudited: number
  totalPairs: number
  autoLinked: number
  candidates: number
  noMatch: number
  /** Distribution of decision outcomes keyed by the firing rule/signal id combination. */
  byRule: Record<string, number>
  /** Counts by make/model/year bucket (only buckets with at least one match). */
  byBucket: Record<string, { pairs: number; autoLinked: number; candidates: number }>
  /** When sourceId was given, the source it was scoped to. */
  scopedToSourceId?: string
  /** A sample of borderline candidate pairs for manual false-positive review. */
  falsePosistiveSample: FalsePositiveSample[]
}

export interface FalsePositiveSample {
  listingAId: string
  listingBId: string
  score: number
  topSignals: string[]
}

async function runVehicleIdentityBackfill(opts: {
  apply: boolean
  sourceId?: string
}): Promise<VehicleIdentityBackfillReport> {
  const db = getDb()

  const report: VehicleIdentityBackfillReport = {
    totalListingsAudited: 0,
    totalPairs: 0,
    autoLinked: 0,
    candidates: 0,
    noMatch: 0,
    byRule: {},
    byBucket: {},
    ...(opts.sourceId !== undefined ? { scopedToSourceId: opts.sourceId } : {}),
    falsePosistiveSample: [],
  }

  // Load all active, unmatched listings (no vehicleId) optionally scoped to a source.
  // We load in batches to keep peak memory bounded. Each batch advances a cursor.
  const allListings: Listing[] = []
  let cursor: string | undefined
  for (;;) {
    const rows = await db.listing.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      where: {
        status: 'active',
        vehicleId: null,
        ...(opts.sourceId ? { sourceId: opts.sourceId } : {}),
      },
      orderBy: { id: 'asc' },
      include: { source: { select: { name: true } } },
    })
    if (rows.length === 0) break
    allListings.push(...rows)
    cursor = rows[rows.length - 1]!.id
    if (rows.length < BATCH_SIZE) break
  }

  report.totalListingsAudited = allListings.length

  // Group into make/model/year buckets — same bucketing as the live job.
  const buckets = new Map<string, Listing[]>()
  for (const listing of allListings) {
    const key = `${listing.make.trim().toLowerCase()}|${listing.model.trim().toLowerCase()}|${listing.year}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(listing)
    else buckets.set(key, [listing])
  }

  // Borderline candidate scores for false-positive sampling (score between
  // CANDIDATE_THRESHOLD and CANDIDATE_THRESHOLD + 30 are "borderline").
  const borderlineCandidates: FalsePositiveSample[] = []

  const decidedAt = new Date()

  for (const [bucketKey, bucket] of buckets) {
    if (bucket.length < 2) continue

    const bucketLabel = bucketKey.replace(/\|/g, ' ')
    const pairCount = (bucket.length * (bucket.length - 1)) / 2

    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const listingA = bucket[i]!
        const listingB = bucket[j]!
        report.totalPairs++

        const result = matchListingPair(toMatchable(listingA), toMatchable(listingB))

        // Accumulate rule/signal distributions from the primary signal that fired.
        for (const signal of result.signals) {
          if (signal.weight > 0) {
            report.byRule[signal.id] = (report.byRule[signal.id] ?? 0) + 1
          }
        }

        // Per-bucket stats.
        if (result.decision !== 'no_match') {
          report.byBucket[bucketLabel] ??= { pairs: pairCount, autoLinked: 0, candidates: 0 }
          if (result.decision === 'auto_link') {
            report.byBucket[bucketLabel]!.autoLinked++
          } else {
            report.byBucket[bucketLabel]!.candidates++
          }
        }

        if (result.decision === 'auto_link') {
          report.autoLinked++
          if (opts.apply) {
            await upsertVehicleIdentityDecision(db, {
              listingAId: listingA.id,
              listingBId: listingB.id,
              state: VehicleIdentityDecisionState.verified,
              signals: signalsToJson(result),
              ruleId: result.ruleId,
              decidedAt,
            })
          }
        } else if (result.decision === 'candidate') {
          report.candidates++
          if (opts.apply) {
            await upsertVehicleIdentityDecision(db, {
              listingAId: listingA.id,
              listingBId: listingB.id,
              state: VehicleIdentityDecisionState.candidate,
              signals: signalsToJson(result),
              ruleId: result.ruleId,
              decidedAt,
            })
          }
          // Track borderline candidates for false-positive sampling.
          borderlineCandidates.push({
            listingAId: listingA.id,
            listingBId: listingB.id,
            score: result.score,
            topSignals: result.signals
              .filter((s) => s.weight > 0)
              .sort((a, b) => b.weight - a.weight)
              .slice(0, 3)
              .map((s) => `${s.id}(+${s.weight})`),
          })
        } else {
          report.noMatch++
        }
      }
    }
  }

  // Sample the borderline candidates by score (lowest scores = most borderline =
  // highest false-positive risk).
  report.falsePosistiveSample = borderlineCandidates
    .sort((a, b) => a.score - b.score)
    .slice(0, FALSE_POSITIVE_SAMPLE_SIZE)

  await db.$disconnect()
  return report
}

function toMatchable(listing: Listing): MatchableListing {
  return {
    id: listing.id,
    sourceId: listing.sourceId,
    dealerProfileId: listing.dealerProfileId,
    dealerWebsite: listing.dealerWebsite,
    dealerName: listing.dealerName,
    stockNumber: listing.stockNumber,
    sourceUrl: listing.sourceUrl,
    make: listing.make,
    model: listing.model,
    year: listing.year,
    trim: listing.trim,
    vin: listing.vin,
    mileage: listing.mileage,
    priceCents: listing.priceCents,
    zip: listing.zip,
    city: listing.city,
    state: listing.state,
  }
}

function signalsToJson(result: VehicleIdentityMatchResult): {
  score: number
  stableIdentifierMatch: boolean
  signals: { id: string; detail: string; weight: number }[]
} {
  return {
    score: result.score,
    stableIdentifierMatch: result.stableIdentifierMatch,
    signals: result.signals.map((s) => ({ id: s.id, detail: s.detail, weight: s.weight })),
  }
}

function printReport(report: VehicleIdentityBackfillReport, applied: boolean): void {
  const mode = applied ? 'APPLIED' : 'REPORT ONLY'
  const scope = report.scopedToSourceId ? ` [source: ${report.scopedToSourceId}]` : ''
  console.log(`\n=== Vehicle Identity Backfill [${mode}]${scope} ===\n`)

  console.log(`Active listings audited: ${report.totalListingsAudited}`)
  console.log(`Candidate pairs scored:  ${report.totalPairs}`)
  console.log(`  Auto-linked: ${report.autoLinked}`)
  console.log(`  Candidates:  ${report.candidates}`)
  console.log(`  No match:    ${report.noMatch}`)
  if (report.totalPairs > 0) {
    const autoLinkPct = ((report.autoLinked / report.totalPairs) * 100).toFixed(1)
    const candidatePct = ((report.candidates / report.totalPairs) * 100).toFixed(1)
    console.log(`  Auto-link rate: ${autoLinkPct}%`)
    console.log(`  Candidate rate: ${candidatePct}%`)
  }

  if (Object.keys(report.byBucket).length > 0) {
    console.log('\n── By make/model/year bucket (matched buckets only) ──')
    const sorted = Object.entries(report.byBucket).sort((a, b) => b[1].autoLinked + b[1].candidates - (a[1].autoLinked + a[1].candidates))
    for (const [bucket, counts] of sorted) {
      console.log(`  ${bucket}: ${counts.autoLinked} auto-linked, ${counts.candidates} candidates (${counts.pairs} total pairs)`)
    }
  }

  if (Object.keys(report.byRule).length > 0) {
    console.log('\n── Positive-signal distribution (signals that contributed to a match) ──')
    const sorted = Object.entries(report.byRule).sort((a, b) => b[1] - a[1])
    for (const [rule, count] of sorted) {
      console.log(`  ${rule}: ${count}`)
    }
  }

  if (report.falsePosistiveSample.length > 0) {
    console.log('\n── False-positive risk sample (lowest-scoring candidates — review before applying) ──')
    for (const item of report.falsePosistiveSample) {
      console.log(`  [score ${item.score}] ${item.listingAId} vs ${item.listingBId}`)
      console.log(`    signals: ${item.topSignals.join(', ')}`)
    }
  } else if (report.candidates === 0) {
    console.log('\nNo candidate pairs found — no false-positive risk to sample.')
  }

  if (!applied) {
    console.log('\nThis was a dry run. No decisions were persisted.')
    console.log('Run with --apply to persist decisions (optionally --source <sourceId> for phased rollout).')
  } else {
    console.log('\nDecisions persisted. Run the meilisearch-sync job to update search index groupings.')
  }

  console.log('\n=== Done ===\n')
}

// ── CLI entry point ─────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { apply: boolean; sourceId?: string } {
  const applyMode = argv.includes('--apply')
  if (!applyMode && !argv.includes('--report')) {
    console.error('Usage: vehicle-identity-backfill.ts --report | --apply [--source <sourceId>]')
    process.exit(1)
  }
  const sourceIdx = argv.indexOf('--source')
  const sourceId = sourceIdx >= 0 ? argv[sourceIdx + 1] : undefined
  return sourceId !== undefined ? { apply: applyMode, sourceId } : { apply: applyMode }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2))
  runVehicleIdentityBackfill(options)
    .then((report) => {
      printReport(report, options.apply)
    })
    .catch((err: unknown) => {
      console.error('Backfill failed:', err)
      process.exit(1)
    })
}

export { runVehicleIdentityBackfill }
