/**
 * #499 field-claims backfill.
 *
 * Deploying the claim/evidence resolution model does not retroactively
 * populate `ListingFieldClaim` for listings scraped before it shipped —
 * those rows have a `conversionType`/`rampType` value but no claim history
 * and default to `conversionTypeResolution`/`rampTypeResolution: 'unknown'`.
 * This backfill seeds one `structured_source` claim per field from the
 * currently-stored value (the best evidence trail available for pre-#499
 * data — we cannot reconstruct which pipeline stage originally wrote it),
 * so those listings get a `source_reported` resolution instead of sitting
 * at `unknown` indefinitely.
 *
 * Safety: this backfill can only ever produce `source_reported` (it seeds
 * exactly one claim per field), never `conflicting` — it cannot introduce a
 * new conflict on its own. A listing already touched by the live pipeline
 * (has any claim for that field) is left alone entirely, so a real scrape
 * always wins over this backfill regardless of run order.
 *
 * Usage:
 *   pnpm tsx apps/scraper/src/jobs/field-claims-backfill.ts --report
 *   pnpm tsx apps/scraper/src/jobs/field-claims-backfill.ts --apply
 *
 * Always run --report first — it evaluates every active listing and prints
 * totals by field and resolution state without writing anything, per the
 * issue's release-safety requirement to review before public filtering
 * behavior (side/rear and ramp-type search exclusion) is enabled.
 *
 * Deployment procedure:
 * 1. Deploy the #499 persistence/resolver code (this backfill assumes the
 *    `listing_field_claim` table and resolution columns already exist).
 * 2. Run --report. Confirm the `unknown`-after-backfill count is small (it
 *    is exactly the set of listings with no observed conversionType/rampType
 *    at all — nothing to seed) and the `verified`/`conflicting` counts are 0
 *    (this backfill never produces them).
 * 3. Run --apply.
 * 4. Confirm via `GET /admin/field-conflicts` that it is still empty (this
 *    backfill cannot create conflicts; a non-empty result here means a live
 *    scrape landed a conflicting claim concurrently, which is expected and
 *    fine, not a backfill bug).
 * 5. Only then enable any product behavior that depends on the resolution
 *    state distinguishing `source_reported` from `verified` — search/facet
 *    exclusion for `conflicting` is already safe/live regardless, since a
 *    conflicting field's normalized value is `unknown` the instant the
 *    resolver first sees the contradiction.
 *
 * Rollback: this backfill only appends `ListingFieldClaim` rows and updates
 * `conversionTypeResolution`/`rampTypeResolution` (never the normalized
 * `conversionType`/`rampType` value, which it never changes for a listing it
 * seeds). To roll back, delete the seeded claims
 * (`extractorVersion: 'backfill-v1'`) and reset the two resolution columns
 * to `'unknown'` for affected rows — no other data is touched.
 *
 * @module
 */

import { getDb } from '@wivwav/db'
import { applyFieldResolution, recordClaim } from '../resolution/claims-repository.js'
import { NoopPhotoClaimProvider } from '../resolution/photo-claim-provider.js'
import type { ClaimField, FieldResolutionState } from '../resolution/types.js'

const BATCH_SIZE = 500
const BACKFILL_EXTRACTOR_VERSION = 'backfill-v1'
const FIELDS: readonly ClaimField[] = ['conversionType', 'rampType']
const photoClaimProvider = new NoopPhotoClaimProvider()

type FieldTotals = Record<FieldResolutionState, number>

function emptyFieldTotals(): FieldTotals {
  return { verified: 0, source_reported: 0, conflicting: 0, unknown: 0 }
}

export interface FieldClaimsBackfillReport {
  totalEvaluated: number
  /** Listings that already had at least one claim for a field — left untouched. */
  alreadyClaimed: number
  /** Listings a new claim was seeded for (or would be, in --report mode). */
  seeded: number
  byField: Record<ClaimField, FieldTotals>
}

function emptyReport(): FieldClaimsBackfillReport {
  return {
    totalEvaluated: 0,
    alreadyClaimed: 0,
    seeded: 0,
    byField: { conversionType: emptyFieldTotals(), rampType: emptyFieldTotals() },
  }
}

async function runBackfill(opts: { apply: boolean; sourceId?: string }): Promise<FieldClaimsBackfillReport> {
  const db = getDb()
  const report = emptyReport()

  let cursor: string | undefined
  for (;;) {
    const rows = await db.listing.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      where: {
        status: 'active',
        ...(opts.sourceId ? { sourceId: opts.sourceId } : {}),
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        sourceUrl: true,
        conversionType: true,
        rampType: true,
        scrapedAt: true,
      },
    })
    if (rows.length === 0) break

    for (const row of rows) {
      report.totalEvaluated++
      const values: Record<ClaimField, string> = { conversionType: row.conversionType, rampType: row.rampType }

      for (const field of FIELDS) {
        const existingClaims = await db.listingFieldClaim.findFirst({
          where: { listingId: row.id, field },
          select: { id: true },
        })
        if (existingClaims) {
          report.alreadyClaimed++
          continue
        }

        if (values[field] === 'unknown') {
          // Nothing observed for this field at all — stays unknown; no claim to seed.
          report.byField[field].unknown++
          continue
        }

        report.seeded++
        if (opts.apply) {
          await db.$transaction(async (tx) => {
            await recordClaim(tx, {
              listingId: row.id,
              field,
              claimedValue: values[field],
              evidenceKind: 'structured_source',
              sourceRef: row.sourceUrl,
              observedAt: row.scrapedAt,
              extractorVersion: BACKFILL_EXTRACTOR_VERSION,
              confidence: null,
            })
            const { result } = await applyFieldResolution(tx, row.id, field, photoClaimProvider)
            report.byField[field][result.state]++
          })
        } else {
          // --report: a single seeded structured_source claim always
          // resolves to source_reported (one credible signal, no conflict
          // possible) — see resolver.ts. Report that outcome without writing.
          report.byField[field].source_reported++
        }
      }
    }

    cursor = rows[rows.length - 1]!.id
    if (rows.length < BATCH_SIZE) break
  }

  await db.$disconnect()
  return report
}

function printReport(report: FieldClaimsBackfillReport, applied: boolean): void {
  const mode = applied ? 'APPLIED' : 'REPORT ONLY'
  console.log(`\n=== #499 Field Claims Backfill [${mode}] ===\n`)
  console.log(`Total active listings evaluated: ${report.totalEvaluated}`)
  console.log(`  Already had claims (untouched): ${report.alreadyClaimed}`)
  console.log(`  Claims seeded: ${report.seeded}`)

  for (const field of FIELDS) {
    console.log(`\n── ${field} resolution totals ──`)
    const totals = report.byField[field]
    for (const state of ['verified', 'source_reported', 'conflicting', 'unknown'] as const) {
      console.log(`  ${state}: ${totals[state]}`)
    }
  }

  console.log('\n=== Done ===\n')
}

function parseArgs(argv: string[]): { apply: boolean; sourceId?: string } {
  const applyMode = argv.includes('--apply')
  const reportMode = argv.includes('--report') || !applyMode
  if (!applyMode && !reportMode) {
    console.error('Usage: field-claims-backfill.ts --report | --apply [--source <sourceId>]')
    process.exit(1)
  }
  const sourceIdx = argv.indexOf('--source')
  const sourceId = sourceIdx >= 0 ? argv[sourceIdx + 1] : undefined
  return sourceId !== undefined ? { apply: applyMode, sourceId } : { apply: applyMode }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2))
  runBackfill(options)
    .then((report) => {
      printReport(report, options.apply)
      if (!options.apply) {
        console.log('Run with --apply to commit these changes to the database.')
      }
    })
    .catch((err: unknown) => {
      console.error('Backfill failed:', err)
      process.exit(1)
    })
}

export { runBackfill }
