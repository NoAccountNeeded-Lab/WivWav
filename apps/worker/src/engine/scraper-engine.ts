import type { SourceAdapter } from '@wivwav/scraper-sources'
import { report } from '@wivwav/scraper-sources'
import type { ScraperRunRepository, SourceRepository, ListingRepository } from './repositories.js'
import {
  validateListing,
  summarizeQuality,
  decidePublication,
  detectSourceDrift,
  SYSTEMIC_ERROR_THRESHOLD,
} from './listing-validator.js'
import type { JobContext } from '../job-context.js'

const DEFAULT_FULL_CRAWL_INTERVAL_HOURS = 24

function sourceExecutionBlockReason(status: string, errorMessage: string | null): string | null {
  if (status === 'disabled') return errorMessage ?? 'Source is disabled by operator policy'
  if (status === 'paused') return errorMessage ?? 'Source is paused'
  return null
}

interface EngineOptions {
  runs: ScraperRunRepository
  sources: SourceRepository
  listings: ListingRepository
  fullCrawlIntervalHours?: number
}

/**
 * Ported from `apps/scraper/src/engine/scraper-engine.ts` (#952). Two
 * deliberate behavioral differences from the in-process original, both
 * because the worker has no database and no AI-provider wiring today:
 *
 * - No `onListingsGone` eager search-index callback — the coordinator's
 *   `/sources/:sourceId/listings/mark-gone` route has no wire equivalent
 *   either; the single-owner `LISTING_INDEX_POLL` poller picks up the
 *   status change on its next tick (matches apps/scraper's own post-#669
 *   posture, see repositories.ts).
 * - `runSource` never calls a geocode job — geocoding stays entirely
 *   DB-side in apps/scraper (phase 2/3 of #948), so there's nothing for a
 *   worker to trigger; the in-process engine's fire-and-forget
 *   `runGeocodeJob()` call is simply absent here.
 *
 * The AI structure-detector integration (`perRunDetector`) is preserved as
 * an optional parameter for interface parity, but `apps/worker` does not
 * wire one today — a structure change degrades to `markNeedsRemapping`
 * (the same fallback path the original code takes when no detector is
 * available), leaving the source for an operator or a future AI-enabled
 * worker build to remap.
 */
export class ScraperEngine {
  private readonly adapters = new Map<string, SourceAdapter>()
  private readonly runs: ScraperRunRepository
  private readonly sources: SourceRepository
  private readonly listings: ListingRepository
  private readonly fullCrawlIntervalHours: number

  constructor(options: EngineOptions) {
    this.runs = options.runs
    this.sources = options.sources
    this.listings = options.listings
    this.fullCrawlIntervalHours = options.fullCrawlIntervalHours ?? DEFAULT_FULL_CRAWL_INTERVAL_HOURS
  }

  register(adapter: SourceAdapter, dbSourceId: string): void {
    this.adapters.set(dbSourceId, adapter)
  }

  async runSource(sourceId: string, context?: JobContext): Promise<boolean> {
    const adapter = this.adapters.get(sourceId)
    if (!adapter) throw new Error(`No adapter registered for source: ${sourceId}`)

    const initialState = await this.sources.getExecutionState(sourceId)
    const initialBlockReason = initialState ? sourceExecutionBlockReason(initialState.status, initialState.errorMessage) : null
    if (initialBlockReason !== null) {
      await report(context, `[source-scrape] Skipped ${adapter.name} (${sourceId}): ${initialBlockReason}`, {
        stage: 'blocked',
        reason: 'source_disabled',
        current: 0,
        total: 0,
      })
      return false
    }

    const run = await this.runs.start(sourceId)
    await report(context, `[source-scrape] Started ${adapter.name} (${sourceId})`, {
      stage: 'checking-structure',
      current: 0,
      total: 0,
    })

    try {
      let page1Hash: string | undefined
      let forceFullCrawl = false

      if (adapter.checkPage1) {
        const page1Check = await adapter.checkPage1()
        page1Hash = page1Check.currentHash

        if (!page1Check.changed) {
          const lastFullCrawlAt = await this.sources.getLastFullCrawlAt(sourceId)
          const fullCrawlIntervalMs = this.fullCrawlIntervalHours * 60 * 60 * 1000
          const isOverdue =
            lastFullCrawlAt === null ||
            Date.now() - lastFullCrawlAt.getTime() > fullCrawlIntervalMs

          if (!isOverdue) {
            await report(context, `[source-scrape] Page 1 unchanged for ${adapter.name}; skipping full crawl (last full crawl within interval)`, {
              stage: 'no_changes',
              current: 0,
              total: 0,
            })
            await this.runs.complete(run.id, 0)
            await this.sources.markChecked(sourceId)
            return false
          }

          forceFullCrawl = true
          await report(context, `[source-scrape] Page 1 unchanged for ${adapter.name} but periodic full crawl is overdue — running full crawl`, {
            stage: 'checking-structure',
            current: 0,
            total: 0,
          })
        } else {
          await report(context, `[source-scrape] Page 1 changed for ${adapter.name}; running full crawl`, {
            stage: 'checking-structure',
            current: 0,
            total: 0,
          })
        }
      }

      const structureCheck = await adapter.checkStructure()
      const structureSummary = `changed=${structureCheck.changed}, previousHash=${structureCheck.previousHash ?? 'none'}, currentHash=${structureCheck.currentHash}`
      await report(context, `[source-scrape] Structure check complete for ${adapter.name}: ${structureSummary}`, {
        stage: structureCheck.changed ? 'structure-changed' : 'scraping',
        current: 0,
        total: 0,
      })

      if (structureCheck.changed) {
        // No AI remap wiring in this worker build (see class docstring) —
        // always take the "operator intervention required" fallback path.
        const failureMode = structureCheck.sampleHtml ? 'structure_changed_ai_unavailable' : 'structure_changed_no_sample_html'
        const errorMessage = structureCheck.sampleHtml
          ? 'Structure changed — AI remapping unavailable; operator intervention required'
          : 'Structure changed — no HTML sample captured; operator intervention required'
        await report(context, `[source-scrape] Structure changed for ${adapter.name}, but ${structureCheck.sampleHtml ? 'AI remapping is unavailable' : 'no sample HTML was captured'}. Marked source needs_remapping; scrape skipped.`, {
          stage: 'blocked',
          reason: failureMode,
          current: 0,
          total: 0,
        })
        await this.sources.markNeedsRemapping(sourceId, errorMessage)
        await this.runs.fail(run.id, errorMessage)
        return false
      }

      const result = await adapter.scrape(context)
      await report(context, `[source-scrape] Scraped ${result.listings.length} listing(s) from ${adapter.name}`, {
        stage: 'validating',
        current: 0,
        total: result.listings.length,
      })

      const validationResults = result.listings.map(l => ({
        sourceRecordKey: l.sourceRecordKey,
        issues: validateListing({ ...l, sourceId }),
      }))
      const decisionByKey = new Map(
        validationResults.map(vr => [vr.sourceRecordKey, decidePublication(vr.issues)]),
      )
      const quality = summarizeQuality(validationResults)

      if (quality.listingsWithIssues > 0) {
        for (const vr of validationResults) {
          if (vr.issues.length === 0) continue
          const summary = vr.issues.map(i => `${i.field}:${i.rule}[${i.severity}]`).join(' ')
          await report(context, `[source-scrape] Quality issue on ${vr.sourceRecordKey}: ${summary}`, {
            stage: 'validating',
            qualityIssue: true,
            sourceRecordKey: vr.sourceRecordKey,
          })
        }

        const errorRate = quality.totalListings > 0 ? quality.errorListings / quality.totalListings : 0
        const qualityMsg = `[source-scrape] Quality summary: ${quality.listingsWithIssues}/${quality.totalListings} listings have issues (${quality.errorListings} error, ${quality.warnListings} warn). Rules: ${JSON.stringify(quality.issuesByRule)}`

        if (errorRate >= SYSTEMIC_ERROR_THRESHOLD && quality.totalListings >= 5) {
          const failMsg = `Data quality check failed: ${Math.round(errorRate * 100)}% of listings have error-level issues (threshold ${Math.round(SYSTEMIC_ERROR_THRESHOLD * 100)}%). Likely DOM structure change. Run aborted to prevent dirty data from being written.`
          await report(context, `[source-scrape] ${failMsg}`, { stage: 'blocked', reason: 'quality_check_failed' })
          await this.runs.fail(run.id, failMsg)
          await this.sources.markError(sourceId, failMsg)
          return false
        }

        await report(context, qualityMsg, { stage: 'upserting', quality })
      }

      if (quality.totalListings > 0) {
        const missingCount = result.listings.filter(
          l => l.make == null || l.model == null || l.priceCents == null,
        ).length
        const baseline = await this.sources.getDriftBaseline(sourceId)
        const drift = detectSourceDrift(baseline, {
          errorRate: quality.errorListings / quality.totalListings,
          missingRate: missingCount / quality.totalListings,
        })
        await this.sources.setDriftBaseline(sourceId, drift.nextBaseline)

        if (drift.drifted) {
          await report(context, `[source-scrape] ${drift.reason}`, { stage: 'blocked', reason: 'source_drift' })
          await this.runs.fail(run.id, drift.reason ?? 'Source quality drifted abruptly')
          await this.sources.markPaused(sourceId, drift.reason ?? 'Source quality drifted abruptly')
          return false
        }
      }

      const preCommitState = await this.sources.getExecutionState(sourceId)
      const preCommitBlockReason = preCommitState ? sourceExecutionBlockReason(preCommitState.status, preCommitState.errorMessage) : null
      if (preCommitBlockReason !== null) {
        await report(context, `[source-scrape] Aborted before commit for ${adapter.name}: ${preCommitBlockReason}`, {
          stage: 'blocked',
          reason: 'source_disabled_mid_run',
          current: 0,
          total: 0,
        })
        await this.runs.fail(run.id, preCommitBlockReason)
        return false
      }

      let listingsNew = 0
      let listingsUpdated = 0
      for (let i = 0; i < result.listings.length; i++) {
        const listing = result.listings[i]!
        const decision = decisionByKey.get(listing.sourceRecordKey)
        const upsert = await this.listings.upsert({
          ...listing,
          sourceId,
          publicationStatus: decision?.publicationStatus ?? 'pending',
          qualityIssueCodes: decision?.qualityIssueCodes ?? listing.qualityIssueCodes ?? [],
          qualityCheckedAt: new Date(),
          runId: context?.runId,
        })
        if (upsert.outcome === 'created') listingsNew++
        if (upsert.outcome === 'updated') listingsUpdated++
        if ((i + 1) % 25 === 0 || i === result.listings.length - 1) {
          await report(context, `[source-scrape] Upserted ${i + 1}/${result.listings.length} listing(s)`, {
            stage: 'upserting',
            current: i + 1,
            total: result.listings.length,
          })
        }
      }

      // All adapter scrapes are currently complete crawls (all pages).
      const isCompleteCrawl = true

      const activeSourceRecordKeys = result.listings.map(l => l.sourceRecordKey)
      const goneCount = await this.listings.markGone(sourceId, activeSourceRecordKeys, {
        isCompleteCrawl,
      })

      await this.runs.complete(run.id, result.listings.length, { listingsNew, listingsUpdated })
      await this.sources.markActive(sourceId, {
        listingCount: result.listings.length,
        fingerprintHash: structureCheck.currentHash,
        ...(page1Hash !== undefined ? { page1Hash } : {}),
        isCompleteCrawl,
      })

      const crawlType = forceFullCrawl ? 'forced full crawl' : 'full crawl'
      await report(context, `[source-scrape] Done (${crawlType}). ${result.listings.length} listing(s), ${goneCount} marked gone.`, {
        stage: 'complete',
        current: result.listings.length,
        total: result.listings.length,
        isCompleteCrawl,
      })

      return listingsNew > 0 || listingsUpdated > 0 || goneCount > 0
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.runs.fail(run.id, message)
      await this.sources.markError(sourceId, message)
      throw err
    }
  }
}
