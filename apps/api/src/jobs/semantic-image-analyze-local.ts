/**
 * Host-side runner core for trying semantic image analysis from a laptop (#1112):
 * photo selection, download, analysis and optional persistence. The command-line
 * entry point (usage, options, rollback notes) is `semantic-image-analyze-local-cli.ts`.
 *
 * @module
 */

import { getDb } from '@wivwav/db'
import type { PrismaClient } from '@wivwav/db'
import { hashImage } from '../images/image-hasher.js'
import { CliOutputError } from '../images/cli-output-parsers.js'
import type {
  AnalysisUsage,
  ImageAnalysisInput,
  ImageAnalysisProvider,
  ImageAnalysisResult,
} from '../images/image-analysis-provider.js'
import {
  findEligibleImagesForSemanticAnalysis,
  type EligibleSemanticAnalysisImage,
} from '../images/semantic-analysis-eligibility.js'
import { filterPhotoCandidates, selectPhotos } from './semantic-image-analyze-local-select.js'
import { round, shareUsage } from './semantic-image-analyze-local-usage.js'
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


/** Eligible photos after stage filtering, dedup against stored rows (persist mode) and the limits. */
export async function selectImages(db: PrismaClient, options: LocalRunOptions): Promise<EligibleSemanticAnalysisImage[]> {
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
  // Rows are never overwritten, so an image that already has one for this version (an error
  // row leaves it eligible) would only cost a model call whose result is thrown away. Drop
  // them before the limit so a re-run reaches new photos.
  const analysedIds = options.persist
    ? new Set(
        (
          await db.listingImageSemanticAnalysis.findMany({
            where: { listingImageId: { in: filtered.images.map((image) => image.id) }, semanticAnalysisVersion: CURRENT_SEMANTIC_ANALYSIS_VERSION },
            select: { listingImageId: true },
          })
        ).map((row) => row.listingImageId),
      )
    : new Set<string>()
  if (analysedIds.size > 0) console.log(`Skipped ${analysedIds.size} photo(s) that already have a stored row for this version.`)
  const images = selectPhotos(filtered.images.filter((image) => !analysedIds.has(image.id)), options.perListing, options.limit)
  if (images.length === 0) {
    console.log('No eligible images. Run image-integrity-backfill.ts --apply --limit N first.')
  }
  return images
}

/** Downloads, analyzes and (with --persist) stores one listing's photos. */
async function analyzeListingGroup(
  db: PrismaClient,
  options: LocalRunOptions,
  listingId: string,
  group: EligibleSemanticAnalysisImage[],
): Promise<LocalRunEntry[]> {
  const entries: LocalRunEntry[] = []
  const started = Date.now()
  const downloads = []
  for (const image of group) {
    const downloaded = await hashImage(image.normalizedUrl, { keepBytes: true })
    if (!downloaded.ok) {
      entries.push({ imageId: image.id, listingId, url: image.normalizedUrl, outcome: 'download_failed', detail: downloaded.kind, seconds: 0 })
    } else {
      downloads.push({ image, downloaded })
    }
  }
  if (downloads.length === 0) return entries

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
  return entries
}

export async function runLocalAnalysis(options: LocalRunOptions): Promise<LocalRunEntry[]> {
  if (options.url) return [await analyzeUrl(options.provider, options.url)]

  const entries: LocalRunEntry[] = []
  const db = getDb()
  try {
    const images = await selectImages(db, options)
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
    for (const [listingId, group] of groups) entries.push(...(await analyzeListingGroup(db, options, listingId, group)))
  } finally {
    await db.$disconnect()
  }
  return entries
}
