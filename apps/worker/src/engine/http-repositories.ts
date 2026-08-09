import type { ScraperGatewayClient } from '../scraper-gateway-client.js'
import type {
  ListingRepository,
  ListingUpsertData,
  ListingUpsertResult,
  MarkGoneOptions,
  ScraperRunRecord,
  ScraperRunRepository,
  SourceExecutionState,
  SourceRepository,
} from './repositories.js'
import type { SourceDriftBaseline } from './listing-validator.js'
import type { FieldMapping } from '@wivwav/types'

/**
 * Shared mutable slot for the current run's id: `ScraperEngine.runSource`
 * calls `runs.start()` once per invocation and later calls
 * `listings.markGone()` with no run id parameter of its own (unchanged port
 * interface — see repositories.ts) — but the coordinator's `mark-gone` route
 * requires `scraperRunId` for its idempotency marker (#948). This tiny
 * shared object is how `HttpScraperRunRepository.start` hands that id to
 * `HttpListingRepository.markGone` without changing either's interface.
 * Both repositories for one job must share the same instance.
 */
export class RunContext {
  runId: string | null = null
}

export class HttpScraperRunRepository implements ScraperRunRepository {
  constructor(
    private readonly client: ScraperGatewayClient,
    private readonly runContext: RunContext,
  ) {}

  async start(sourceId: string): Promise<ScraperRunRecord> {
    const { id } = await this.client.startRun(sourceId)
    this.runContext.runId = id
    return { id }
  }

  async complete(
    id: string,
    listingsFound: number,
    changes?: { listingsNew: number; listingsUpdated: number },
  ): Promise<void> {
    await this.client.completeRun({ runId: id, listingsFound, changes })
  }

  async fail(id: string, errorMessage: string): Promise<void> {
    await this.client.failRun({ runId: id, errorMessage })
  }
}

export class HttpSourceRepository implements SourceRepository {
  constructor(private readonly client: ScraperGatewayClient) {}

  async getExecutionState(id: string): Promise<SourceExecutionState | null> {
    const { state } = await this.client.getExecutionState(id)
    return state
  }

  async markNeedsRemapping(id: string, errorMessage?: string): Promise<void> {
    await this.client.markNeedsRemapping(id, errorMessage)
  }

  async markActive(
    id: string,
    data: { listingCount: number; fingerprintHash: string; page1Hash?: string; isCompleteCrawl: boolean },
  ): Promise<void> {
    await this.client.markActive(id, data)
  }

  async markChecked(id: string): Promise<void> {
    await this.client.markChecked(id)
  }

  async markError(id: string, errorMessage: string): Promise<void> {
    await this.client.markError(id, errorMessage)
  }

  async markPaused(id: string, reason: string): Promise<void> {
    await this.client.markPaused(id, reason)
  }

  async getMappings(id: string): Promise<FieldMapping[]> {
    const { mappings } = await this.client.getMappings(id)
    return mappings
  }

  async setMappings(id: string, mappings: FieldMapping[]): Promise<void> {
    await this.client.setMappings(id, mappings)
  }

  async getLastFullCrawlAt(id: string): Promise<Date | null> {
    const { lastFullCrawlAt } = await this.client.getLastFullCrawlAt(id)
    return lastFullCrawlAt === null ? null : new Date(lastFullCrawlAt)
  }

  async getDriftBaseline(id: string): Promise<SourceDriftBaseline | null> {
    const { baseline } = await this.client.getDriftBaseline(id)
    return baseline
  }

  async setDriftBaseline(id: string, baseline: SourceDriftBaseline): Promise<void> {
    await this.client.setDriftBaseline(id, baseline)
  }
}

export class HttpListingRepository implements ListingRepository {
  constructor(
    private readonly client: ScraperGatewayClient,
    private readonly runContext: RunContext,
  ) {}

  async upsert(listing: ListingUpsertData): Promise<ListingUpsertResult> {
    return this.client.upsertListing({
      ...listing,
      runId: listing.runId ?? this.runContext.runId,
    })
  }

  async markGone(
    sourceId: string,
    activeSourceRecordKeys: string[],
    options: MarkGoneOptions,
  ): Promise<number> {
    if (this.runContext.runId === null) {
      throw new Error('[HttpListingRepository] markGone called before a run was started')
    }
    const { goneCount } = await this.client.markGone(sourceId, {
      scraperRunId: this.runContext.runId,
      activeSourceRecordKeys,
      isCompleteCrawl: options.isCompleteCrawl,
    })
    return goneCount
  }
}
