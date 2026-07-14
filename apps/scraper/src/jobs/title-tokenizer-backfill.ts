/**
 * Title tokenizer backfill job (refs #618).
 *
 * Corrects `model`/`trim` values corrupted by the pre-#618 list-page
 * tokenizers (blvd.ts, mobilityworks.ts, freedom-motors.ts), which assumed
 * `model` was always exactly one token. For a title like "2024 Chrysler
 * Town & Country Touring" this truncated `model` to "Town" and dumped
 * "& Country Touring" into `trim`; "Grand Caravan" titles truncated `model`
 * to "Grand" the same way. Fixed going forward in parse-vehicle-title.ts;
 * this repairs rows scraped before the fix.
 *
 * Detection: `model` exactly equals the first token of a known multi-word
 * model (`MULTI_WORD_MODEL_FIRST_TOKENS`, e.g. "Town", "Grand") — a value no
 * vehicle model is legitimately just one of.
 *
 * Correction: reassemble `${model} ${trim}` (the original title fragment,
 * put back together) and re-tokenize it with the same multi-word-model
 * matcher the fixed parser uses (`matchMultiWordModelTokenCount`), then
 * split the result back into corrected model/trim.
 *
 * Some rows cannot be corrected this way — e.g. a small number of listings
 * where the stored title fragment was already truncated further upstream (a
 * separate, not-yet-root-caused mid-title truncation bug — see the trim
 * values "& C Touring" / "& C" noted in #618) — so the reassembled string
 * still won't match a known multi-word model. These are reported as
 * `unresolved` and require a re-scrape (the source site itself still has the
 * correct, untruncated title) rather than a backfill.
 *
 * Caveat — ambiguous first tokens (e.g. "Transit"): some multi-word models
 * share their first token with a legitimate standalone model ("Transit
 * Connect" vs. plain "Transit"). For these
 * (`AMBIGUOUS_MULTI_WORD_MODEL_FIRST_TOKENS`), a failed reconstruction does
 * NOT imply corruption — it just as often means the row was a correct
 * standalone model all along. Such rows are reported separately as
 * `alreadyCorrect` and require no action, unlike genuinely `unresolved` rows.
 *
 * Usage:
 *   pnpm tsx apps/scraper/src/jobs/title-tokenizer-backfill.ts --report
 *   pnpm tsx apps/scraper/src/jobs/title-tokenizer-backfill.ts --apply
 *
 * Always run --report first to review the scope of changes before --apply.
 *
 * Deployment procedure:
 * 1. Deploy the code fix (parseVehicleTitle wired into blvd.ts,
 *    mobilityworks.ts, and freedom-motors.ts) so freshly scraped rows stop
 *    corrupting model/trim going forward.
 * 2. Run: pnpm tsx apps/scraper/src/jobs/title-tokenizer-backfill.ts --report
 *    Review output — confirm affected counts and corrected values look right.
 * 3. Run: pnpm tsx apps/scraper/src/jobs/title-tokenizer-backfill.ts --apply
 *    This sets publicationStatus = 'pending' on all corrected rows.
 * 4. Run the publication validator to re-evaluate pending rows (pending → eligible).
 * 5. Trigger a full Meilisearch re-index (meilisearch-sync job) so corrected
 *    values are reflected in search documents/facets.
 * 6. For rows reported as `unresolved`, trigger a re-scrape of their source
 *    (ops Refresh Listings > Run active sources) — the site still has the
 *    correct title; only the previously-stored fragment is unrecoverable.
 * 7. Post-release smoke check: query the Meilisearch facets API on `model`
 *    and `trim` and confirm no standalone "Town"/"Grand" model values
 *    remain, and no trim value still starts with "& Country" or "& C".
 *
 * Rollback:
 * - This job is idempotent; running --apply multiple times is safe (once
 *   corrected, a row's model no longer matches a truncated first-token, so
 *   it is excluded from later runs).
 * - Re-scraping any affected source restores model/trim from source going
 *   forward (the list-page adapters no longer truncate multi-word models).
 *
 * @module
 */

import '../lib/load-env.js'

import { getDb } from '@wivwav/db'
import {
  matchMultiWordModelTokenCount,
  MULTI_WORD_MODEL_FIRST_TOKENS,
  AMBIGUOUS_MULTI_WORD_MODEL_FIRST_TOKENS,
} from '@wivwav/search'

interface CorrectedRow {
  id: string
  sourceId: string
  before: { model: string; trim: string | null }
  after: { model: string; trim: string | null }
}

interface UnresolvedRow {
  id: string
  sourceId: string
  model: string
  trim: string | null
}

export interface TitleTokenizerBackfillReport {
  totalCandidates: number
  corrected: {
    total: number
    bySource: Record<string, number>
    samples: CorrectedRow[]
  }
  unresolved: {
    total: number
    bySource: Record<string, number>
    samples: UnresolvedRow[]
  }
  /**
   * Rows whose model exactly matches an ambiguous first token (e.g.
   * "Transit") but failed multi-word reconstruction. Unlike `unresolved`,
   * this does NOT mean the row is corrupted — "Transit" is also a valid
   * standalone model, so these rows were most likely never touched by the
   * pre-#618 bug and require no action.
   */
  alreadyCorrect: {
    total: number
    bySource: Record<string, number>
  }
}

/**
 * Given a possibly-corrupted model/trim pair, attempts to reconstruct the
 * correct split. Returns null if no multi-word model match is found (i.e.
 * the row cannot be repaired from its stored fields alone).
 */
export function reconstructModelTrim(
  model: string,
  trim: string | null,
): { model: string; trim: string | null } | null {
  const tokens = [...model.split(/\s+/), ...(trim ? trim.split(/\s+/) : [])]
  const upperTokens = tokens.map((token) => token.toUpperCase())
  const matchCount = matchMultiWordModelTokenCount(upperTokens)

  // matchCount must extend beyond the original (single-token) model to be an
  // improvement — otherwise there is nothing to correct.
  if (matchCount <= 1) return null

  return {
    model: tokens.slice(0, matchCount).join(' '),
    trim: tokens.slice(matchCount).join(' ') || null,
  }
}

export async function runBackfill(opts: { apply: boolean }): Promise<TitleTokenizerBackfillReport> {
  const db = getDb()
  const report: TitleTokenizerBackfillReport = {
    totalCandidates: 0,
    corrected: { total: 0, bySource: {}, samples: [] },
    unresolved: { total: 0, bySource: {}, samples: [] },
    alreadyCorrect: { total: 0, bySource: {} },
  }

  const candidates = await db.listing.findMany({
    where: { model: { in: [...MULTI_WORD_MODEL_FIRST_TOKENS], mode: 'insensitive' } },
    select: { id: true, sourceId: true, model: true, trim: true, source: { select: { name: true } } },
  })

  report.totalCandidates = candidates.length

  const toApply: Array<{ id: string; model: string; trim: string | null }> = []

  for (const row of candidates) {
    const sourceName = row.source.name
    const reconstructed = reconstructModelTrim(row.model, row.trim)

    if (reconstructed) {
      report.corrected.total++
      report.corrected.bySource[sourceName] = (report.corrected.bySource[sourceName] ?? 0) + 1
      if (report.corrected.samples.length < 20) {
        report.corrected.samples.push({
          id: row.id,
          sourceId: row.sourceId,
          before: { model: row.model, trim: row.trim },
          after: reconstructed,
        })
      }
      toApply.push({ id: row.id, model: reconstructed.model, trim: reconstructed.trim })
    } else if (AMBIGUOUS_MULTI_WORD_MODEL_FIRST_TOKENS.has(row.model.toUpperCase())) {
      // "Transit"-style token: also a valid standalone model, so a failed
      // reconstruction means this row was never corrupted, not that it
      // needs a re-scrape. No action needed.
      report.alreadyCorrect.total++
      report.alreadyCorrect.bySource[sourceName] = (report.alreadyCorrect.bySource[sourceName] ?? 0) + 1
    } else {
      report.unresolved.total++
      report.unresolved.bySource[sourceName] = (report.unresolved.bySource[sourceName] ?? 0) + 1
      if (report.unresolved.samples.length < 20) {
        report.unresolved.samples.push({
          id: row.id,
          sourceId: row.sourceId,
          model: row.model,
          trim: row.trim,
        })
      }
    }
  }

  if (opts.apply && toApply.length > 0) {
    const BATCH = 200
    for (let i = 0; i < toApply.length; i += BATCH) {
      const batch = toApply.slice(i, i + BATCH)
      await db.$transaction(
        batch.map((row) =>
          db.listing.update({
            where: { id: row.id },
            data: {
              model: row.model,
              trim: row.trim,
              // Invalidate publication status so the validator re-evaluates with corrected fields
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

function printReport(report: TitleTokenizerBackfillReport, applied: boolean): void {
  const mode = applied ? 'APPLIED' : 'REPORT ONLY'
  console.log(`\n=== Title Tokenizer Backfill [${mode}] ===\n`)

  console.log(`Total candidate rows (model matches a known truncated first-token): ${report.totalCandidates}`)

  console.log('\n── Corrected (model/trim reconstructed) ──')
  console.log(`  Total: ${report.corrected.total}`)
  console.log('  By source:')
  for (const [source, count] of Object.entries(report.corrected.bySource)) {
    console.log(`    ${source}: ${count}`)
  }
  for (const sample of report.corrected.samples) {
    console.log(
      `    [${sample.id}] "${sample.before.model}" / "${sample.before.trim ?? ''}" → "${sample.after.model}" / "${sample.after.trim ?? ''}"`,
    )
  }

  console.log('\n── Unresolved (needs re-scrape) ──')
  console.log(`  Total: ${report.unresolved.total}`)
  console.log('  By source:')
  for (const [source, count] of Object.entries(report.unresolved.bySource)) {
    console.log(`    ${source}: ${count}`)
  }
  for (const sample of report.unresolved.samples) {
    console.log(`    [${sample.id}] model="${sample.model}" trim="${sample.trim ?? ''}"`)
  }

  console.log('\n── Already correct (ambiguous first token, e.g. "Transit" — no action needed) ──')
  console.log(`  Total: ${report.alreadyCorrect.total}`)
  console.log('  By source:')
  for (const [source, count] of Object.entries(report.alreadyCorrect.bySource)) {
    console.log(`    ${source}: ${count}`)
  }

  console.log('\n=== Done ===\n')
}

// ── CLI entry point ─────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const applyMode = args.includes('--apply')
  const reportMode = args.includes('--report') || !applyMode

  if (!applyMode && !reportMode) {
    console.error('Usage: title-tokenizer-backfill.ts --report | --apply')
    process.exit(1)
  }

  runBackfill({ apply: applyMode })
    .then((report) => {
      printReport(report, applyMode)
      if (!applyMode) {
        console.log('Run with --apply to commit these changes to the database.')
      }
      if (report.unresolved.total > 0) {
        console.log(
          `${report.unresolved.total} row(s) could not be corrected from stored data and need a re-scrape.`,
        )
      }
    })
    .catch((err: unknown) => {
      console.error('Backfill failed:', err)
      process.exit(1)
    })
}
