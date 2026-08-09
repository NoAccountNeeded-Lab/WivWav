import { findScraperSourceByName } from '@wivwav/types'
import { SOURCE_ADAPTER_MODULES, type SourceAdapter } from '@wivwav/scraper-sources'
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
  browserService: PlaywrightBrowserService,
  logger: WivWavLogger,
) {
  return async (payload: unknown, correlationId: string): Promise<SourceScrapeJobResult> => {
    if (!isSourceScrapePayload(payload)) {
      throw new Error('[source-scrape] payload must be { sourceId: string }')
    }
    const { sourceId } = payload

    const profile = await gateway.getSourceProfile(sourceId)
    const registryEntry = findScraperSourceByName(profile.name)
    if (!registryEntry) {
      throw new Error(`[source-scrape] no registry entry for source name '${profile.name}'`)
    }
    const module = SOURCE_ADAPTER_MODULES[registryEntry.key]
    if (!module) {
      throw new Error(`[source-scrape] no adapter module for registry key '${registryEntry.key}'`)
    }

    const adapter: SourceAdapter = module.createSourceAdapter(profile.fingerprintHash, {
      previousPage1Hash: profile.page1Hash,
      browserService,
    })

    const runContext = new RunContext()
    const engine = new ScraperEngine({
      runs: new HttpScraperRunRepository(gateway, runContext),
      sources: new HttpSourceRepository(gateway),
      listings: new HttpListingRepository(gateway, runContext),
    })
    engine.register(adapter, sourceId)

    const context = createJobContext(logger, correlationId)
    const listingsChanged = await engine.runSource(sourceId, context)
    return { listingsChanged }
  }
}
