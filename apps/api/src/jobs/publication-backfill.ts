/**
 * Publication validator backfill (issue #502).
 *
 * Before the comprehensive per-listing validator in
 * apps/api/src/engine/listing-validator.ts is enforced for new scrapes,
 * this backfill audits every currently-active listing against the same rules
 * so operators can see the expected quarantine volume and rule breakdown
 * *before* enforcement begins. Active listings are otherwise left alone in
 * --report mode; --apply applies the validator decision exactly as the live
 * pipeline would (the same decidePublication() call used by ScraperEngine and
 * vin-enrich).
 *
 * Usage:
 *   pnpm tsx apps/api/src/jobs/publication-backfill.ts --report
 *   pnpm tsx apps/api/src/jobs/publication-backfill.ts --apply
 *
 * Always run --report first to review expected quarantine volume and rule
 * breakdown before --apply.
 *
 * Deployment procedure:
 * 1. Run: pnpm tsx apps/api/src/jobs/publication-backfill.ts --report
 *    Review output — confirm the quarantine rate looks plausible (not a
 *    large fraction of an otherwise-healthy source; a high rate on one
 *    source may indicate a source-specific extraction bug rather than dirty
 *    data, and is worth a manual sample check before applying).
 * 2. Roll out gradually if the report shows a large volume: apply to one
 *    source at a time via --source <sourceId>, watching the operator
 *    quarantine list (GET /admin/quarantine?sourceId=...) after each.
 * 3. Run: pnpm tsx apps/api/src/jobs/publication-backfill.ts --apply
 *    This sets publicationStatus to 'eligible' or 'quarantined' (from
 *    'pending') on every currently-active listing.
 * 4. Trigger a full Meilisearch re-index (meilisearch-sync job) so the index
 *    only contains the newly-eligible set.
 * 5. Post-release smoke check:
 *    - GET /admin/quarantine — confirm the count matches the --report total.
 *    - Spot-check 5-10 quarantined listings against their source page to
 *      confirm the rule firing is a genuine data problem, not a validator bug.
 *    - Confirm public listing counts (GET /admin/listing-refresh/status)
 *      dropped by roughly the quarantined count, not more.
 *
 * Rollback:
 * - This job is idempotent; running --apply multiple times is safe (it
 *   always re-derives the decision from current field values).
 * - To roll back entirely, set publicationStatus back to 'eligible' for
 *   every row whose qualityCheckedAt is within the backfill's run window —
 *   or simply re-run the validator after reverting the rule change that
 *   caused unwanted quarantines.
 *
 * @module
 */

import '../lib/load-env.js'

import { getDb } from '@wivwav/db'
import { validateListing, decidePublication } from '../engine/listing-validator.js'

const BATCH_SIZE = 500

interface BackfillReport {
  totalAudited: number
  eligible: number
  quarantined: number
  bySource: Record<string, { audited: number; quarantined: number }>
  issuesByRule: Record<string, number>
}

async function runBackfill(opts: { apply: boolean; sourceId?: string }): Promise<BackfillReport> {
  const db = getDb()
  const report: BackfillReport = {
    totalAudited: 0,
    eligible: 0,
    quarantined: 0,
    bySource: {},
    issuesByRule: {},
  }

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
      include: { source: { select: { name: true } } },
    })
    if (rows.length === 0) break

    const updates: Array<{ id: string; publicationStatus: 'eligible' | 'quarantined'; qualityIssueCodes: string[] }> = []

    for (const row of rows) {
      const issues = validateListing({
        sourceId: row.sourceId,
        sourceUrl: row.sourceUrl,
        buyerUrl: row.buyerUrl,
        externalId: row.externalId,
        stockNumber: row.stockNumber,
        sourceRecordKey: row.sourceRecordKey,
        make: row.make,
        model: row.model,
        year: row.year,
        trim: row.trim,
        vin: row.vin,
        condition: row.condition,
        sellerType: row.sellerType,
        priceCents: row.priceCents,
        mileage: row.mileage,
        color: row.color,
        fuelType: row.fuelType,
        transmission: row.transmission,
        wav: {
          conversionType: row.conversionType,
          conversionManufacturer: row.conversionManufacturer,
          floorLoweringInches: row.floorLoweringInches,
          rampType: row.rampType,
          conversionStatus: row.conversionStatus,
          wavFeatures: row.wavFeatures,
          wheelchairCapacity: row.wheelchairCapacity,
        },
        location: { zip: row.zip, city: row.city, state: row.state, lat: row.lat, lng: row.lng },
        dealer: { name: row.dealerName, phone: row.dealerPhone, website: row.dealerWebsite },
        images: row.images,
        description: row.description,
        saleStatus: row.saleStatus,
        soldAt: row.soldAt,
        listedAt: row.listedAt,
      })
      const decision = decidePublication(issues)

      report.totalAudited++
      const sourceName = row.source.name
      report.bySource[sourceName] ??= { audited: 0, quarantined: 0 }
      report.bySource[sourceName]!.audited++

      if (decision.publicationStatus === 'eligible') {
        report.eligible++
      } else {
        report.quarantined++
        report.bySource[sourceName]!.quarantined++
        for (const code of decision.qualityIssueCodes) {
          report.issuesByRule[code] = (report.issuesByRule[code] ?? 0) + 1
        }
      }

      updates.push({ id: row.id, publicationStatus: decision.publicationStatus, qualityIssueCodes: decision.qualityIssueCodes })
    }

    if (opts.apply) {
      const now = new Date()
      await db.$transaction(
        updates.map((update) =>
          db.listing.update({
            where: { id: update.id },
            data: {
              publicationStatus: update.publicationStatus,
              qualityIssueCodes: update.qualityIssueCodes,
              qualityCheckedAt: now,
            },
          }),
        ),
      )
    }

    cursor = rows[rows.length - 1]!.id
    if (rows.length < BATCH_SIZE) break
  }

  await db.$disconnect()
  return report
}

function printReport(report: BackfillReport, applied: boolean): void {
  const mode = applied ? 'APPLIED' : 'REPORT ONLY'
  console.log(`\n=== Publication Backfill [${mode}] ===\n`)

  console.log(`Total active listings audited: ${report.totalAudited}`)
  console.log(`  Eligible:    ${report.eligible}`)
  console.log(`  Quarantined: ${report.quarantined}`)
  if (report.totalAudited > 0) {
    const pct = ((report.quarantined / report.totalAudited) * 100).toFixed(1)
    console.log(`  Quarantine rate: ${pct}%`)
  }

  console.log('\n── By source ──')
  for (const [source, counts] of Object.entries(report.bySource)) {
    const pct = counts.audited > 0 ? ((counts.quarantined / counts.audited) * 100).toFixed(1) : '0.0'
    console.log(`  ${source}: ${counts.quarantined}/${counts.audited} quarantined (${pct}%)`)
  }

  console.log('\n── Rule breakdown (quarantined listings) ──')
  const sorted = Object.entries(report.issuesByRule).sort((a, b) => b[1] - a[1])
  for (const [rule, count] of sorted) {
    console.log(`  ${rule}: ${count}`)
  }

  console.log('\n=== Done ===\n')
}

// ── CLI entry point ─────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { apply: boolean; sourceId?: string } {
  const applyMode = argv.includes('--apply')
  const reportMode = argv.includes('--report') || !applyMode
  if (!applyMode && !reportMode) {
    console.error('Usage: publication-backfill.ts --report | --apply [--source <sourceId>]')
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

export { runBackfill, type BackfillReport }
