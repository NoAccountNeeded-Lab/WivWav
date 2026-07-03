import type { SourceAdapter } from './source-adapter.js'
import type { StructureDetector } from '../ai/structure-detector.js'
import type { ScraperRunRepository, SourceRepository, ListingRepository } from './repositories.js'
import {
  validateListing,
  summarizeQuality,
  decidePublication,
  detectSourceDrift,
  SYSTEMIC_ERROR_THRESHOLD,
} from './listing-validator.js'
import { runGeocodeJob } from '../jobs/geocode.js'
import { report } from '../jobs/job-progress.js'
import type { JobContext } from '@wivwav/queue'

const REMAP_CONFIDENCE_THRESHOLD = 0.7

/**
 * Total attempts (including the first) allowed for a single AI remap call before
 * falling back to `markNeedsRemapping`. A malformed/transient response (bad JSON,
 * missing fields, provider timeout) is often a one-off, so a bounded retry avoids
 * taking a source offline for an operator to notice and fix.
 *
 * Exported so tests can assert the retry-loop call count against this constant
 * rather than a hardcoded literal that would silently drift if this changes.
 */
export const MAX_REMAP_ATTEMPTS = 2

/**
 * Number of hours after which a periodic full crawl is forced even if page-1
 * is unchanged. This prevents price and removal changes on later pages from
 * remaining invisible indefinitely.
 *
 * Default: 24 hours. Override by passing `fullCrawlIntervalHours` in EngineOptions.
 */
const DEFAULT_FULL_CRAWL_INTERVAL_HOURS = 24

/** Safely format a confidence value. Returns '?.??' when the value is not a finite number. */
function formatConfidence(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '?.??'
}

interface EngineOptions {
  runs: ScraperRunRepository
  sources: SourceRepository
  listings: ListingRepository
  /** Hours between forced full crawls when page-1 is unchanged. Default: 24. */
  fullCrawlIntervalHours?: number
  /**
   * Called with the ids of listings newly marked `gone` by markGone during a
   * complete crawl, so the caller can remove them from the search index
   * immediately rather than waiting for the next full-catalog rebuild. Must
   * not throw — see MarkGoneOptions.onGone.
   */
  onListingsGone?: (ids: string[]) => Promise<void>
}

export class ScraperEngine {
  private readonly adapters = new Map<string, SourceAdapter>()
  private readonly runs: ScraperRunRepository
  private readonly sources: SourceRepository
  private readonly listings: ListingRepository
  private readonly fullCrawlIntervalHours: number
  private readonly onListingsGone: ((ids: string[]) => Promise<void>) | undefined

  constructor(options: EngineOptions) {
    this.runs = options.runs
    this.sources = options.sources
    this.listings = options.listings
    this.fullCrawlIntervalHours = options.fullCrawlIntervalHours ?? DEFAULT_FULL_CRAWL_INTERVAL_HOURS
    this.onListingsGone = options.onListingsGone
  }

  // dbSourceId is the DB record's CUID — the key used by all repository methods.
  register(adapter: SourceAdapter, dbSourceId: string): void {
    this.adapters.set(dbSourceId, adapter)
  }

  async runSource(sourceId: string, context?: JobContext, perRunDetector?: StructureDetector | null): Promise<boolean> {
    const adapter = this.adapters.get(sourceId)
    if (!adapter) throw new Error(`No adapter registered for source: ${sourceId}`)

    const run = await this.runs.start(sourceId)
    await report(context, `[source-scrape] Started ${adapter.name} (${sourceId})`, {
      stage: 'checking-structure',
      current: 0,
      total: 0,
    })

    try {
      // Page 1 gatekeeper: hash the listing IDs on page 1 sorted by newest.
      // When unchanged, skip the full crawl UNLESS a periodic full crawl is overdue.
      // This ensures price/removal changes on later pages are eventually detected
      // even when page 1 appears stable.
      let page1Hash: string | undefined
      let forceFullCrawl = false

      if (adapter.checkPage1) {
        const page1Check = await adapter.checkPage1()
        page1Hash = page1Check.currentHash

        if (!page1Check.changed) {
          // Check if a periodic full crawl is overdue
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
        const detector = perRunDetector ?? null
        if (structureCheck.sampleHtml && detector) {
          try {
            const previousMappings = await this.sources.getMappings(sourceId)

            // A single malformed/transient AI response shouldn't permanently lock the
            // source into needs_remapping, so retry the AI call itself a bounded number
            // of times before giving up. The final attempt's error is what surfaces to
            // the operator if every attempt fails.
            let remap: Awaited<ReturnType<StructureDetector['remapFields']>> | undefined
            let lastAttemptErr: unknown
            for (let attempt = 1; attempt <= MAX_REMAP_ATTEMPTS; attempt++) {
              try {
                remap = await detector.remapFields({
                  sourceName: adapter.name,
                  previousMappings,
                  sampleHtml: structureCheck.sampleHtml,
                })
                break
              } catch (attemptErr) {
                lastAttemptErr = attemptErr
                if (attempt < MAX_REMAP_ATTEMPTS) {
                  const attemptErrMsg = attemptErr instanceof Error ? attemptErr.message : String(attemptErr)
                  await report(context, `[source-scrape] AI remap attempt ${attempt}/${MAX_REMAP_ATTEMPTS} failed for ${adapter.name} (${attemptErrMsg}); retrying.`, {
                    stage: 'structure-changed',
                    current: attempt,
                    total: MAX_REMAP_ATTEMPTS,
                  })
                }
              }
            }
            if (remap === undefined) {
              // Every attempt threw (or MAX_REMAP_ATTEMPTS is misconfigured to < 1 and the
              // loop never ran) — surface the last real error, or a fallback if none exists,
              // rather than ever throwing `undefined`.
              throw lastAttemptErr ?? new Error('AI remap failed with no attempts recorded')
            }

            await this.sources.setMappings(sourceId, remap.mappings)

            if (remap.confidence >= REMAP_CONFIDENCE_THRESHOLD) {
              await report(context, `[source-scrape] Structure changed for ${adapter.name}; AI remapped with confidence ${formatConfidence(remap.confidence)}. Proceeding with scrape using updated mappings.`, {
                stage: 'scraping',
                current: 0,
                total: 0,
              })
              // Fall through: attempt scrape with existing adapter now that mappings are updated.
              // If the scrape produces low-quality data the quality gate below will abort the run.
            } else {
              // Low confidence: record failure with full AI context but do NOT mark needs_remapping.
              // Leaving the source in error state means the next scheduled run will retry automatically.
              const message = `Structure changed — low-confidence remap (confidence ${formatConfidence(remap.confidence)}): ${remap.notes}`
              await report(context, `[source-scrape] ${message}. Source left in error state for automatic retry on next run.`, {
                stage: 'blocked',
                reason: 'structure_changed_low_confidence_remap',
                current: 0,
                total: 0,
              })
              await this.sources.markError(sourceId, message)
              await this.runs.fail(run.id, message)
              return false
            }
          } catch (remapErr) {
            // AI threw (bad JSON, timeout, etc.) — degrade to needs_remapping rather than
            // rethrowing, which would cause BullMQ to retry the job immediately and infinitely.
            const remapErrMsg = remapErr instanceof Error ? remapErr.message : String(remapErr)
            const errorMessage = `Structure changed — AI remapping failed (${remapErrMsg}); operator intervention required`
            await report(context, `[source-scrape] Structure changed for ${adapter.name}, but AI remapping threw an error. Marked source needs_remapping; scrape skipped.`, {
              stage: 'blocked',
              reason: 'structure_changed_ai_failed',
              current: 0,
              total: 0,
            })
            await this.sources.markNeedsRemapping(sourceId, errorMessage)
            await this.runs.fail(run.id, errorMessage)
            return false
          }
        } else {
          // No sample HTML or AI unavailable: requires operator intervention, mark needs_remapping
          // with a structured message that identifies which failure mode occurred.
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
      }

      const result = await adapter.scrape(context)
      await report(context, `[source-scrape] Scraped ${result.listings.length} listing(s) from ${adapter.name}`, {
        stage: 'validating',
        current: 0,
        total: result.listings.length,
      })

      // Validate all listings before upserting so dirty data is caught in the job log.
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
          // >20% error-severity issues on a meaningful sample means extraction is systemically broken.
          const failMsg = `Data quality check failed: ${Math.round(errorRate * 100)}% of listings have error-level issues (threshold ${Math.round(SYSTEMIC_ERROR_THRESHOLD * 100)}%). Likely DOM structure change. Run aborted to prevent dirty data from being written.`
          await report(context, `[source-scrape] ${failMsg}`, { stage: 'blocked', reason: 'quality_check_failed' })
          await this.runs.fail(run.id, failMsg)
          await this.sources.markError(sourceId, failMsg)
          return false
        }

        await report(context, qualityMsg, { stage: 'upserting', quality })
      }

      // Source-level drift: compare this run's error/missing rate against the source's
      // rolling baseline. This is a separate, complementary signal to the fixed systemic
      // threshold above — it catches sources whose baseline is already elevated (so the
      // fixed 20% cutoff never trips) or that degrade gradually run-over-run.
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
      // The page-1 gatekeeper is an optimization that skips this path entirely
      // when unchanged and the periodic interval has not elapsed.
      // Any run that reaches here traversed the full source index.
      const isCompleteCrawl = true

      const activeSourceRecordKeys = result.listings.map(l => l.sourceRecordKey)
      const goneCount = await this.listings.markGone(sourceId, activeSourceRecordKeys, {
        isCompleteCrawl,
        ...(this.onListingsGone ? { onGone: this.onListingsGone } : {}),
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

      runGeocodeJob().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        void context?.log(`[engine] Geocode job failed (non-fatal): ${msg}`)
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
