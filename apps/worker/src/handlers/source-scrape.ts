import { readWorkerSetting } from '../operator-setting.js'
import { findScraperSourceByName } from '@wivwav/types'
import { report, SOURCE_ADAPTER_MODULES, type SourceAdapter } from '@wivwav/scraper-sources'
import type { PlaywrightBrowserService } from '@wivwav/scraper-sources/browser/playwright-browser-service.js'
import type { SourceScrapeJobResult } from '@wivwav/types/scraper-gateway'
import type { WivWavLogger } from '@wivwav/logger'
import { ScraperEngine } from '../engine/scraper-engine.js'
import { HttpListingRepository, HttpScraperRunRepository, HttpSourceRepository, RunContext } from '../engine/http-repositories.js'
import type { ScraperGatewayClient } from '../scraper-gateway-client.js'
import { createJobContext } from '../job-context.js'

export interface SourceScrapePayload {
  sourceId: string
}

/**
 * True when the coordinator already handed this job to a Chromium-capable
 * worker (#1043): it stamps `capabilityEscalation` into the persisted job
 * payload. Such a job must never escalate again — a further block fails.
 */
function wasEscalated(payload: SourceScrapePayload): boolean {
  return (payload as { capabilityEscalation?: unknown }).capabilityEscalation !== undefined
}

function isSourceScrapePayload(payload: unknown): payload is SourceScrapePayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as Record<string, unknown>)['sourceId'] === 'string'
  )
}

/**
 * SOURCE_SCRAPE handler (#952): resolves the dispatched `sourceId` to its
 * registry adapter module, runs the ported `ScraperEngine` against
 * Http*Repository implementations, and returns `{ listingsChanged }` —
 * matching `sourceScrapeJobResultSchema`, which the coordinator's gateway
 * processor reads to decide whether to enqueue the LISTING_SYNC/
 * LISTING_RESOLVE follow-ons (see apps/api/src/worker-gateway/gateway-workers.ts).
 */
export function createSourceScrapeHandler(
  gateway: ScraperGatewayClient,
  // Optional (#1041): a worker without chromium capability has no
  // PlaywrightBrowserService to give — it can still run SOURCE_SCRAPE for
  // sources whose adapter doesn't need one (the dispatcher only sends this
  // worker jobs its registry entry's requiresBrowser allows, see
  // apps/api/src/worker-gateway/gateway-workers.ts).
  browserService: PlaywrightBrowserService | undefined,
  logger: WivWavLogger,
) {
  return async (payload: unknown, correlationId: string): Promise<SourceScrapeJobResult> => {
    if (!isSourceScrapePayload(payload)) {
      throw new Error('[source-scrape] payload must be { sourceId: string }')
    }
    const { sourceId } = payload

    const context = createJobContext(logger, correlationId)
    const profile = await gateway.getSourceProfile(sourceId)
    const registryEntry = findScraperSourceByName(profile.name)
    if (!registryEntry) {
      throw new Error(`[source-scrape] no registry entry for source name '${profile.name}'`)
    }
    const module = SOURCE_ADAPTER_MODULES[registryEntry.key]
    if (!module) {
      throw new Error(`[source-scrape] no adapter module for registry key '${registryEntry.key}'`)
    }

    let ebayCredentials
    if (registryEntry.key === 'ebay-motors') {
      const { state } = await gateway.getExecutionState(sourceId)
      const blockReason = state && (state.status === 'disabled' || state.status === 'paused')
        ? state.errorMessage ?? `Source is ${state.status}`
        : null
      if (blockReason !== null) {
        await report(context, `[source-scrape] Skipped source ${sourceId}: ${blockReason}`, {
          stage: 'blocked',
          reason: 'source_disabled',
          current: 0,
          total: 0,
        })
        return { listingsChanged: false }
      }

      ebayCredentials = await gateway.getEbayMotorsCredentials()
    }

    const adapter: SourceAdapter = module.createSourceAdapter(profile.fingerprintHash, {
      previousPage1Hash: profile.page1Hash,
      ...(browserService ? { browserService } : {}),
      // Only a not-yet-escalated job may ask for a more capable worker.
      allowCapabilityEscalation: !wasEscalated(payload),
      ...(ebayCredentials ? { ebayCredentials } : {}),
    })

    const runContext = new RunContext()
    const fullCrawlIntervalHours = await readWorkerSetting(gateway, 'scraper.full_crawl_interval_hours', logger)
    const engine = new ScraperEngine({
      fullCrawlIntervalHours,
      runs: new HttpScraperRunRepository(gateway, runContext),
      sources: new HttpSourceRepository(gateway),
      listings: new HttpListingRepository(gateway, runContext),
    })
    engine.register(adapter, sourceId)

    const listingsChanged = await engine.runSource(sourceId, context)
    return { listingsChanged }
  }
}
