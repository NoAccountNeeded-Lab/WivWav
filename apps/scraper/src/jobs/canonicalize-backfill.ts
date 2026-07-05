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
 * 3. Colors corrupted by MobilityWorks card field-label bleed (refs #608)
 *    - Listings with no real color value had the *next* field's label and
 *      value ("Conv MakeEldorado") captured into color instead, because the
 *      old field-boundary regex only truncated bleed when a space preceded
 *      the next label — it never matched at position 0. Fixed going forward
 *      in mobilityworks.ts; this repairs rows scraped before the fix.
 *    - Detects by checking if color starts with a known field-label token
 *    - In report mode: emits affected rows and sample values by source
 *    - In apply mode: sets color = null for affected rows
 *
 * Usage:
 *   pnpm tsx apps/scraper/src/jobs/canonicalize-backfill.ts --report
 *   pnpm tsx apps/scraper/src/jobs/canonicalize-backfill.ts --apply
 *
 * Always run --report first to review the scope of changes before --apply.
 *
 * Deployment procedure:
 * 1. Deploy the schema migration (adds engine column).
 * 2. Run: pnpm tsx apps/scraper/src/jobs/canonicalize-backfill.ts --report
 *    Review output — confirm affected counts and sample values look correct.
 * 3. Run: pnpm tsx apps/scraper/src/jobs/canonicalize-backfill.ts --apply
 *    This sets publicationStatus = 'pending' on all corrected rows.
 * 4. Run the publication validator to re-evaluate pending rows (pending → eligible).
 *    Until this step completes, corrected rows are not publicly visible.
 * 5. Trigger a full Meilisearch re-index (meilisearch-sync job) so canonical values
 *    are reflected in search documents.
 * 6. Post-release smoke check: query the Meilisearch facets API on 'fuelType' and
 *    'color' and verify no engine descriptions (e.g. "3.5L V6") or leaked field
 *    labels (e.g. "Conv MakeEldorado") appear in results.
 *
 * Rollback:
 * - This job is idempotent; running --apply multiple times is safe.
 * - Re-scraping BLVD detail pages restores the engine field from source.
 *   fuelType remains null (correct) for BLVD listings going forward.
 * - Re-scraping MobilityWorks restores color from source going forward (the
 *   listing card extraction no longer bleeds the next field's label into it).
 *
 * @module
 */

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Load apps/scraper/.env relative to this file (not process.cwd()) so the
// documented root-level usage above works when invoked as
// `pnpm tsx apps/scraper/src/jobs/canonicalize-backfill.ts` from the repo
// root, matching the packages/db/prisma.config.ts pattern. Without this,
// DATABASE_URL is undefined and Prisma fails with a SASL auth error rather
// than a clear "missing env var" message (refs #656).
config({ path: resolve(fileURLToPath(import.meta.url), '..', '..', '..', '.env') })

import { getDb } from '@wivwav/db'
import { canonicalConversionManufacturer, ENGINE_DESCRIPTION_PATTERN } from '@wivwav/search'

/**
 * Matches a color value that starts with a leaked MobilityWorks card field
 * label rather than an actual color name (refs #608). A legitimate color
 * never begins with one of these tokens.
 *
 * No trailing `\b`: the leaked label sits directly against the next label's
 * value with no separating whitespace (e.g. "Conv MakeEldorado"), so a word
 * boundary would never match right after "Make".
 */
export const COLOR_FIELD_BLEED_PATTERN =
  /^(?:Mileage|Color|Conv\s*Make|Conversion|Location|Stock|Request|Schedule)/i

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
  colorFieldBleedFixes: {
    total: number
    bySource: Record<string, number>
    sampleValues: Record<string, number>
  }
}

export async function runBackfill(opts: { apply: boolean }): Promise<BackfillReport> {
  const db = getDb()
  const report: BackfillReport = {
    engineFuelTypeFixes: { total: 0, bySource: {}, samples: [] },
    converterFixes: { total: 0, bySource: {}, rejectedValues: {} },
    colorFieldBleedFixes: { total: 0, bySource: {}, sampleValues: {} },
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
    (row) => canonicalConversionManufacturer(row.conversionManufacturer) === null,
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

  // ── 3. Colors corrupted by MobilityWorks field-label bleed ─────────────────

  const colorRows = await db.listing.findMany({
    where: { color: { not: null } },
    select: { id: true, sourceId: true, color: true, source: { select: { name: true } } },
  })

  const colorAffected = colorRows.filter(
    (row) => row.color && COLOR_FIELD_BLEED_PATTERN.test(row.color),
  )

  report.colorFieldBleedFixes.total = colorAffected.length
  for (const row of colorAffected) {
    const sourceName = row.source.name
    const val = row.color!
    report.colorFieldBleedFixes.bySource[sourceName] =
      (report.colorFieldBleedFixes.bySource[sourceName] ?? 0) + 1
    report.colorFieldBleedFixes.sampleValues[val] =
      (report.colorFieldBleedFixes.sampleValues[val] ?? 0) + 1
  }

  if (opts.apply && colorAffected.length > 0) {
    const BATCH = 200
    for (let i = 0; i < colorAffected.length; i += BATCH) {
      const batch = colorAffected.slice(i, i + BATCH)
      await db.$transaction(
        batch.map((row) =>
          db.listing.update({
            where: { id: row.id },
            data: {
              color: null,
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

  console.log('\n── Colors corrupted by field-label bleed ──')
  console.log(`  Total affected: ${report.colorFieldBleedFixes.total}`)
  console.log('  By source:')
  for (const [source, count] of Object.entries(report.colorFieldBleedFixes.bySource)) {
    console.log(`    ${source}: ${count}`)
  }
  console.log('  Sample values (with counts):')
  const sortedColors = Object.entries(report.colorFieldBleedFixes.sampleValues).sort((a, b) => b[1] - a[1])
  for (const [val, count] of sortedColors.slice(0, 30)) {
    console.log(`    "${val}" × ${count}`)
  }

  console.log('\n=== Done ===\n')
}

// ── CLI entry point ─────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
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
}
