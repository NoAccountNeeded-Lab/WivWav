/**
 * Canonicalization backfill job (refs #515).
 *
 * Audits and optionally repairs listing fields that were stored incorrectly
 * before the canonicalization layer was introduced:
 *
 * 1. Engine descriptions stored as fuelType (BLVD source only)
 *    - Detects by checking if fuelType matches the engine-description pattern
 *    - In report mode: emits a summary of affected rows and sample values
 *    - In apply mode: moves value from fuelType → engine, sets fuelType = null
 *
 * 2. Conversion manufacturer values that fail canonicalConversionManufacturer()
 *    - Detects year numbers, generic text, missing-value tokens
 *    - In report mode: emits rejected values and their counts by source
 *    - In apply mode: sets conversionManufacturer = null for rejected rows
 *
 * Usage:
 *   pnpm tsx apps/scraper/src/jobs/canonicalize-backfill.ts --report
 *   pnpm tsx apps/scraper/src/jobs/canonicalize-backfill.ts --apply
 *
 * Always run --report first to review the scope of changes before --apply.
 *
 * Deployment and rollback:
 * - This job is idempotent; running --apply multiple times is safe.
 * - Rollback: re-scraping BLVD detail pages restores the engine field from
 *   source. fuelType will remain null (correct) for BLVD listings going forward.
 * - Post-release smoke check: after --apply, run a Meilisearch facets query on
 *   'fuelType' and verify no engine descriptions (e.g. "3.5L V6") appear in results.
 *
 * @module
 */

import { getDb } from '@wivwav/db'
import { canonicalConversionManufacturer } from '@wivwav/search'

/** Patterns that identify engine descriptions rather than fuel type labels. */
const ENGINE_DESCRIPTION_PATTERN =
  /\b(?:\d+\.\d+\s*[Ll]|v[468]|[46]-?cyl(?:inder)?|dohc|sohc|ohv|ohc|hemi|ecoboost|vtec|vvt|i[346]|inline[346]|diesel\s+engine|turbocharged|supercharged)\b/i

interface BackfillReport {
  engineFuelTypeFixes: {
    total: number
    bySource: Record<string, number>
    samples: Array<{ id: string; sourceId: string; fuelType: string }>
  }
  converterFixes: {
    total: number
    bySource: Record<string, number>
    rejectedValues: Record<string, number>
  }
}

async function runBackfill(opts: { apply: boolean }): Promise<BackfillReport> {
  const db = getDb()
  const report: BackfillReport = {
    engineFuelTypeFixes: { total: 0, bySource: {}, samples: [] },
    converterFixes: { total: 0, bySource: {}, rejectedValues: {} },
  }

  // ── 1. Engine descriptions stored as fuelType ──────────────────────────────

  const engineRows = await db.listing.findMany({
    where: { fuelType: { not: null } },
    select: { id: true, sourceId: true, fuelType: true, source: { select: { name: true } } },
  })

  const engineAffected = engineRows.filter(
    (row) => row.fuelType && ENGINE_DESCRIPTION_PATTERN.test(row.fuelType),
  )

  report.engineFuelTypeFixes.total = engineAffected.length
  for (const row of engineAffected) {
    const sourceName = row.source.name
    report.engineFuelTypeFixes.bySource[sourceName] =
      (report.engineFuelTypeFixes.bySource[sourceName] ?? 0) + 1
    if (report.engineFuelTypeFixes.samples.length < 20) {
      report.engineFuelTypeFixes.samples.push({
        id: row.id,
        sourceId: row.sourceId,
        fuelType: row.fuelType!,
      })
    }
  }

  if (opts.apply && engineAffected.length > 0) {
    // Move engine descriptions from fuelType → engine in batches of 200
    const BATCH = 200
    for (let i = 0; i < engineAffected.length; i += BATCH) {
      const batch = engineAffected.slice(i, i + BATCH)
      // Use a transaction to move each row atomically
      await db.$transaction(
        batch.map((row) =>
          db.listing.update({
            where: { id: row.id },
            data: {
              engine: row.fuelType,
              fuelType: null,
              // Invalidate publication status so the validator re-evaluates with correct fields
              publicationStatus: 'pending',
            },
          }),
        ),
      )
    }
  }

  // ── 2. Conversion manufacturer values that fail canonicalization ────────────

  const converterRows = await db.listing.findMany({
    where: { conversionManufacturer: { not: null } },
    select: {
      id: true,
      sourceId: true,
      conversionManufacturer: true,
      source: { select: { name: true } },
    },
  })

  const converterAffected = converterRows.filter(
    (row) => canonicalConversionManufacturer(row.conversionManufacturer, row.source.name) === null,
  )

  report.converterFixes.total = converterAffected.length
  for (const row of converterAffected) {
    const sourceName = row.source.name
    const val = row.conversionManufacturer!
    report.converterFixes.bySource[sourceName] =
      (report.converterFixes.bySource[sourceName] ?? 0) + 1
    report.converterFixes.rejectedValues[val] =
      (report.converterFixes.rejectedValues[val] ?? 0) + 1
  }

  if (opts.apply && converterAffected.length > 0) {
    const BATCH = 200
    for (let i = 0; i < converterAffected.length; i += BATCH) {
      const batch = converterAffected.slice(i, i + BATCH)
      await db.$transaction(
        batch.map((row) =>
          db.listing.update({
            where: { id: row.id },
            data: {
              conversionManufacturer: null,
              publicationStatus: 'pending',
            },
          }),
        ),
      )
    }
  }

  await db.$disconnect()
  return report
}

function printReport(report: BackfillReport, applied: boolean): void {
  const mode = applied ? 'APPLIED' : 'REPORT ONLY'
  console.log(`\n=== Canonicalize Backfill [${mode}] ===\n`)

  console.log('── Engine descriptions stored as fuelType ──')
  console.log(`  Total affected: ${report.engineFuelTypeFixes.total}`)
  console.log('  By source:')
  for (const [source, count] of Object.entries(report.engineFuelTypeFixes.bySource)) {
    console.log(`    ${source}: ${count}`)
  }
  if (report.engineFuelTypeFixes.samples.length > 0) {
    console.log('  Sample fuelType values (engine descriptions):')
    const seen = new Set<string>()
    for (const s of report.engineFuelTypeFixes.samples) {
      if (!seen.has(s.fuelType)) {
        seen.add(s.fuelType)
        console.log(`    "${s.fuelType}"`)
      }
    }
  }

  console.log('\n── Rejected conversion manufacturer values ──')
  console.log(`  Total affected: ${report.converterFixes.total}`)
  console.log('  By source:')
  for (const [source, count] of Object.entries(report.converterFixes.bySource)) {
    console.log(`    ${source}: ${count}`)
  }
  console.log('  Rejected values (with counts):')
  const sorted = Object.entries(report.converterFixes.rejectedValues).sort((a, b) => b[1] - a[1])
  for (const [val, count] of sorted.slice(0, 30)) {
    console.log(`    "${val}" × ${count}`)
  }

  console.log('\n=== Done ===\n')
}

// ── CLI entry point ─────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const applyMode = args.includes('--apply')
const reportMode = args.includes('--report') || !applyMode

if (!applyMode && !reportMode) {
  console.error('Usage: canonicalize-backfill.ts --report | --apply')
  process.exit(1)
}

runBackfill({ apply: applyMode })
  .then((report) => {
    printReport(report, applyMode)
    if (!applyMode) {
      console.log('Run with --apply to commit these changes to the database.')
    }
  })
  .catch((err: unknown) => {
    console.error('Backfill failed:', err)
    process.exit(1)
  })
