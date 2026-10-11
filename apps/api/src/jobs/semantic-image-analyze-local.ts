/**
 * Host-side runner for trying semantic image analysis from a laptop (#1112).
 *
 * Runs outside Docker and outside BullMQ, so it can use the operator's own
 * `claude` / `codex` CLI login. It writes nothing to the database unless
 * `--persist` is given.
 *
 * Usage (from the repo root; DATABASE_URL must reach the dev database from
 * the host, e.g. postgresql://wav:wav@localhost:5432/wivwav):
 *   pnpm tsx apps/api/src/jobs/semantic-image-analyze-local.ts --provider claude-cli --url <image-url>
 *   pnpm tsx apps/api/src/jobs/semantic-image-analyze-local.ts --provider codex-cli --limit 5
 *   pnpm tsx apps/api/src/jobs/semantic-image-analyze-local.ts --provider claude-cli --limit 5 --persist
 *
 * Modes:
 *   --url <image-url>  Analyze one image. No database access at all.
 *   (default)          Dry run over eligible images from the database: calls
 *                      the provider, validates each result, writes a JSON
 *                      report, and stores nothing.
 *   --persist          Also writes `listing_image_semantic_analysis` rows and
 *                      marks the image analyzed. Rows are keyed by image,
 *                      content hash and version, NOT provider; an existing
 *                      row (including an error row) is never overwritten and
 *                      blocks a re-run for that image; images that already have
 *                      a row for the current version are skipped before any model
 *                      call and reported as `existing`. Dry-run first.
 *
 * Eligible images need `listing_image` rows, created by
 * `image-integrity-backfill.ts --apply [--source <id>] --limit N`. Run that
 * first on a small scope.
 *
 * Photos are meant to come last. By default only listings that the other stages
 * left with an unknown conversion or ramp type are analyzed, and listings whose
 * source has a detail crawl that has not reached them yet are skipped
 * (--include-resolved / --include-unfinished override each).
 *
 * --plan lists the images that would be analyzed (no download, no model call,
 * nothing stored) so the scope can be checked before spending any calls.
 *
 * Options: --provider noop|claude-cli|codex-cli (required), --model <name>,
 *   --limit N (default 5; 0 = every eligible image), --per-listing N (default 4,
 *   gallery order; 0 = all photos), --max-edge N (longest photo edge sent to the
 *   model, default 1024; 0 = original), --source <sourceId>, --out <report.json>,
 *   --timeout-seconds N (default 120).
 *
 * Rollback after --persist:
 *   DELETE FROM "listing_image_semantic_analysis" WHERE "provider" = '<provider>';
 *   UPDATE "listing_image" li SET "semanticAnalysisVersion" = NULL
 *     WHERE NOT EXISTS (SELECT 1 FROM "listing_image_semantic_analysis" a
 *                       WHERE a."listingImageId" = li."id");
 *
 * Do NOT run `semantic-image-analyze-backfill.ts --apply` to "try it": the
 * queue worker uses the Noop provider, which stores empty `success` rows and
 * marks every image analyzed.
 *
 * @module
 */

import '../lib/load-env.js'

import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from '@wivwav/db'
import { hashImage } from '../images/image-hasher.js'
import { CliOutputError } from '../images/cli-output-parsers.js'
import type {
  AnalysisUsage,
  ImageAnalysisInput,
  ImageAnalysisProvider,
  ImageAnalysisResult,
} from '../images/image-analysis-provider.js'
import {
  createImageAnalysisProvider,
  isImageAnalysisProviderName,
} from '../images/image-analysis-provider-factory.js'
import {
  findEligibleImagesForSemanticAnalysis,
  type EligibleSemanticAnalysisImage,
} from '../images/semantic-analysis-eligibility.js'
import { filterPhotoCandidates, selectPhotos } from './semantic-image-analyze-local-select.js'
import { round, shareUsage, summarizeUsage } from './semantic-image-analyze-local-usage.js'
import type { LocalRunEntry } from './semantic-image-analyze-local-usage.js'
import {
  analyzeListingImage,
  CURRENT_SEMANTIC_ANALYSIS_VERSION,
  validateImageAnalysisResult,
} from '../images/semantic-image-analysis.js'

export { filterPhotoCandidates, selectPhotos } from './semantic-image-analyze-local-select.js'
export type { CandidateFilterResult, ListingStageInfo } from './semantic-image-analyze-local-select.js'
export { summarizeUsage } from './semantic-image-analyze-local-usage.js'
export type { LocalRunEntry, UsageTotals } from './semantic-image-analyze-local-usage.js'

export interface LocalRunOptions {
  provider: ImageAnalysisProvider
  url?: string
  /** Maximum photos to process; undefined means no limit (`--limit 0`). */
  limit: number | undefined
  /** Skip listings whose conversion type and ramp type are both already known. */
  onlyGaps: boolean
  /** Skip listings whose source has a detail stage that has not run for them yet. */
  requireFinishedStages: boolean
  /** Maximum photos taken from any one listing, in gallery order; undefined means no cap (`--per-listing 0`). */
  perListing: number | undefined
  sourceId?: string
  persist: boolean
  /** List what would be analyzed without downloading or calling the model. */
  plan: boolean
  outPath: string
}

interface Analysed {
  result?: ImageAnalysisResult
  error?: string
  usage?: AnalysisUsage
  batchSize: number
}

/**
 * Analyzes one listing's photos: a single batched call when the provider
 * supports it, otherwise (or if the model's reply was unusable or had the
 * wrong number of results) one call per photo. A timeout, missing binary or
 * non-zero exit is not retried: it would only spend another full timeout.
 */
async function analyzeInputs(provider: ImageAnalysisProvider, inputs: ImageAnalysisInput[]): Promise<Analysed[]> {
  if (provider.analyzeBatch && inputs.length > 1) {
    try {
      const results = await provider.analyzeBatch(inputs)
      if (results.length === inputs.length) {
        const usage = shareUsage(provider.getLastUsage?.(), inputs.length)
        return results.map((result) => ({ result, ...(usage ? { usage } : {}), batchSize: inputs.length }))
      }
      console.log(`  batch returned ${results.length} results for ${inputs.length} photos; retrying one by one`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!(err instanceof CliOutputError)) return inputs.map(() => ({ error: message, batchSize: inputs.length }))
      console.log(`  batch failed (${message}); retrying one by one`)
    }
  }
  const out: Analysed[] = []
  for (const input of inputs) {
    try {
      const result = await provider.analyze(input)
      const usage = shareUsage(provider.getLastUsage?.(), 1)
      out.push({ result, ...(usage ? { usage } : {}), batchSize: 1 })
    } catch (err) {
      out.push({ error: err instanceof Error ? err.message : String(err), batchSize: 1 })
    }
  }
  return out
}

function toEntry(
  analysed: Analysed,
  base: { imageId: string | null; listingId?: string; url: string },
  seconds: number,
): LocalRunEntry {
  const common = {
    ...base,
    ...(analysed.usage ? { usage: analysed.usage } : {}),
    batchSize: analysed.batchSize,
    seconds,
  }
  if (analysed.result === undefined) return { ...common, outcome: 'error', detail: analysed.error ?? 'unknown error' }
  const validated = validateImageAnalysisResult(analysed.result)
  const extras = analysed.result.extras
  return validated
    ? { ...common, outcome: 'valid', result: validated, ...(extras ? { extras } : {}) }
    : { ...common, outcome: 'invalid', result: analysed.result }
}

async function analyzeUrl(provider: ImageAnalysisProvider, url: string): Promise<LocalRunEntry> {
  const started = Date.now()
  const seconds = () => round((Date.now() - started) / 1000, 1)
  const downloaded = await hashImage(url, { keepBytes: true })
  if (!downloaded.ok) return { imageId: null, url, outcome: 'download_failed', detail: downloaded.kind, seconds: seconds() }
  const [analysed] = await analyzeInputs(provider, [
    {
      imageBytes: downloaded.bytes!,
      contentType: downloaded.contentType,
      schemaVersion: String(CURRENT_SEMANTIC_ANALYSIS_VERSION),
    },
  ])
  return toEntry(analysed!, { imageId: null, url }, seconds())
}


export async function runLocalAnalysis(options: LocalRunOptions): Promise<LocalRunEntry[]> {
  const entries: LocalRunEntry[] = []

  if (options.url) {
    entries.push(await analyzeUrl(options.provider, options.url))
    return entries
  }

  const db = getDb()
  try {
    const eligible = await findEligibleImagesForSemanticAnalysis(db, {
      ...(options.sourceId ? { sourceId: options.sourceId } : {}),
    })
    const listingRows = await db.listing.findMany({
      where: { id: { in: [...new Set(eligible.map((image) => image.listingId))] } },
      select: { id: true, sourceId: true, conversionType: true, rampType: true, detailScrapedAt: true },
    })
    const filtered = filterPhotoCandidates(
      eligible,
      new Map(listingRows.map((row) => [row.id, row])),
      { onlyGaps: options.onlyGaps, requireFinishedStages: options.requireFinishedStages },
    )
    if (filtered.skippedUnfinished > 0 || filtered.skippedResolved > 0) {
      console.log(
        `Skipped ${filtered.skippedUnfinished} listing(s) still waiting on their detail crawl and ` +
          `${filtered.skippedResolved} already resolved (use --include-unfinished / --include-resolved to keep them).`,
      )
    }
    const images = selectPhotos(filtered.images, options.perListing, options.limit)
    if (images.length === 0) {
      console.log('No eligible images. Run image-integrity-backfill.ts --apply --limit N first.')
    }
    if (options.plan) {
      for (const image of images) {
        entries.push({ imageId: image.id, listingId: image.listingId, url: image.normalizedUrl, outcome: 'planned', seconds: 0 })
        console.log(`would analyze ${image.id} (listing ${image.listingId}, photo ${image.position}) ${image.normalizedUrl}`)
      }
      return entries
    }

    // One group per listing, in order. Sequential on purpose: one subscription CLI call at a time.
    const groups = new Map<string, EligibleSemanticAnalysisImage[]>()
    for (const image of images) groups.set(image.listingId, [...(groups.get(image.listingId) ?? []), image])

    for (const [listingId, allImages] of groups) {
      const started = Date.now()
      // Rows are never overwritten, so an image that already has one for this version would
      // only cost a model call whose result is thrown away.
      const analysedIds = options.persist
        ? new Set(
            (
              await db.listingImageSemanticAnalysis.findMany({
                where: { listingImageId: { in: allImages.map((image) => image.id) }, semanticAnalysisVersion: CURRENT_SEMANTIC_ANALYSIS_VERSION },
                select: { listingImageId: true },
              })
            ).map((row) => row.listingImageId),
          )
        : new Set<string>()
      const group = allImages.filter((image) => !analysedIds.has(image.id))
      for (const image of allImages) {
        if (analysedIds.has(image.id)) {
          entries.push({ imageId: image.id, listingId, url: image.normalizedUrl, outcome: 'existing', seconds: 0 })
        }
      }
      const downloads = []
      for (const image of group) {
        const downloaded = await hashImage(image.normalizedUrl, { keepBytes: true })
        if (!downloaded.ok) {
          entries.push({ imageId: image.id, listingId, url: image.normalizedUrl, outcome: 'download_failed', detail: downloaded.kind, seconds: 0 })
        } else {
          downloads.push({ image, downloaded })
        }
      }
      if (downloads.length === 0) continue

      const analysed = await analyzeInputs(
        options.provider,
        downloads.map(({ downloaded }) => ({
          imageBytes: downloaded.bytes!,
          contentType: downloaded.contentType,
          schemaVersion: String(CURRENT_SEMANTIC_ANALYSIS_VERSION),
        })),
      )
      const seconds = round((Date.now() - started) / 1000 / downloads.length, 1)

      for (const [index, { image, downloaded }] of downloads.entries()) {
        const entry = toEntry(analysed[index]!, { imageId: image.id, listingId, url: image.normalizedUrl }, seconds)
        // Only validated results are stored; a failed or malformed attempt must not
        // leave a row, because rows are never overwritten and would block a re-run.
        if (options.persist && entry.outcome === 'valid') {
          const result = analysed[index]!.result!
          const row = await analyzeListingImage(
            db,
            { name: options.provider.name, model: options.provider.model ?? analysed[index]!.usage?.model ?? null, analyze: async () => result },
            {
              listingImageId: image.id,
              contentHash: downloaded.exactHash,
              imageBytes: downloaded.bytes!,
              contentType: downloaded.contentType,
            },
          )
          entry.outcome = row.status === 'success' ? 'stored' : 'error'
          if (row.errorMessage) entry.detail = row.errorMessage
        }
        entries.push(entry)
      }
      const cost = analysed.reduce((sum, a) => sum + (a.usage?.costUsd ?? 0), 0)
      console.log(
        `listing ${listingId}: ${downloads.length} photo(s), ${analysed[0]?.batchSize === 1 && downloads.length > 1 ? 'one by one' : 'one call'}, ` +
          `${entries.filter((e) => e.listingId === listingId && (e.outcome === 'valid' || e.outcome === 'stored')).length} ok` +
          (cost > 0 ? `, $${cost.toFixed(4)}` : ''),
      )
    }
  } finally {
    await db.$disconnect()
  }
  return entries
}

function arg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

export function parseArgs(argv: string[]): LocalRunOptions {
  const providerName = arg(argv, '--provider')
  if (!providerName || !isImageAnalysisProviderName(providerName)) {
    throw new Error('--provider noop|claude-cli|codex-cli is required')
  }
  const limit = Number.parseInt(arg(argv, '--limit') ?? '5', 10)
  if (!Number.isInteger(limit) || limit < 0) throw new Error('--limit must be a whole number (0 = no limit)')
  const perListing = Number.parseInt(arg(argv, '--per-listing') ?? '4', 10)
  if (!Number.isInteger(perListing) || perListing < 0) throw new Error('--per-listing must be a whole number (0 = no cap)')
  const timeoutSeconds = Number.parseInt(arg(argv, '--timeout-seconds') ?? '120', 10)
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) throw new Error('--timeout-seconds must be a positive whole number')
  const maxEdge = Number.parseInt(arg(argv, '--max-edge') ?? '1024', 10)
  if (!Number.isInteger(maxEdge) || maxEdge < 0) throw new Error('--max-edge must be a whole number of pixels (0 = send the original)')
  const model = arg(argv, '--model')
  const url = arg(argv, '--url')
  const sourceId = arg(argv, '--source')
  const persist = argv.includes('--persist')
  const onlyGaps = !argv.includes('--include-resolved')
  const requireFinishedStages = !argv.includes('--include-unfinished')
  const plan = argv.includes('--plan')
  if (plan && (persist || url)) throw new Error('--plan lists database images only; it cannot be combined with --persist or --url')
  if (persist && url) throw new Error('--persist cannot be combined with --url (no database image to attach to)')
  if (persist && providerName === 'noop') throw new Error('--persist with the noop provider would store empty results')
  return {
    provider: createImageAnalysisProvider(providerName, {
      ...(model ? { model } : {}),
      timeoutMs: timeoutSeconds * 1000,
      maxImageEdgePx: maxEdge,
    }),
    ...(url ? { url } : {}),
    limit: limit === 0 ? undefined : limit,
    perListing: perListing === 0 ? undefined : perListing,
    onlyGaps,
    requireFinishedStages,
    ...(sourceId ? { sourceId } : {}),
    persist,
    plan,
    outPath: arg(argv, '--out') ?? join(tmpdir(), `semantic-image-analyze-${Date.now()}.json`),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const entries = await runLocalAnalysis(options)
    const totals = summarizeUsage(entries)
    await writeFile(
      options.outPath,
      JSON.stringify({ provider: options.provider.name, model: options.provider.model, persisted: options.persist, totals, entries }, null, 2),
    )
    const counts = entries.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.outcome]: (acc[e.outcome] ?? 0) + 1 }), {})
    console.log(`\n${entries.length} image(s): ${JSON.stringify(counts)}`)
    if (totals.photos > 0) {
      const cost = totals.costUsd === null
        ? 'cost not reported by this CLI'
        : `$${totals.costUsd.toFixed(3)} API-equivalent: $${totals.costPerListing}/listing, about $${totals.costPer1000Photos} per 1,000 photos`
      console.log(`Usage: ${totals.photos} photo(s) in ${totals.calls} call(s), ${totals.inputTokens} input / ${totals.outputTokens} output tokens, avg ${totals.avgSecondsPerPhoto}s/photo, ${cost}`)
    }
    console.log(`Report: ${options.outPath}`)
    if (options.url && entries[0]?.result) console.log(JSON.stringify(entries[0].result, null, 2))
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
