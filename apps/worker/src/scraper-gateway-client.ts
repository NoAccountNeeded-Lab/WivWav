import type {
  DetailCrawlPendingListingsResponse,
  DetailExtractPendingRawPagesResponse,
  DetailExtractSubmitRequest,
  DetailExtractSubmitResponse,
  ListingBySourceUrlResponse,
  ListingMarkGoneByUrlResponse,
  ListingMarkGoneResponse,
  ListingUpsertRequest,
  ListingUpsertResponse,
  RawPageUpsertResponse,
  ScraperRunCompleteRequest,
  ScraperRunFailRequest,
  ScraperRunStartResponse,
  SourceDriftBaseline,
  SourceExecutionStateResponse,
  SourceMappingsResponse,
} from '@wivwav/types/scraper-gateway'
import type { FieldMapping } from '@wivwav/types'
import type { HttpClient } from './http-client.js'

/** Extra profile fields the worker needs to construct a SourceAdapter (#952) — see docker/worker's Dockerfile comment and apps/api's `GET /sources/:id/profile` route. */
export interface SourceProfile {
  id: string
  name: string
  baseUrl: string
  fingerprintHash: string | null
  page1Hash: string | null
}

/**
 * Typed wrapper over every `/internal/scraper/*` route the worker calls.
 * Kept as one class (rather than one per port interface) so the Http*
 * Repository adapters below can share a single HTTP client and auth token.
 */
export class ScraperGatewayClient {
  constructor(private readonly http: HttpClient) {}

  // --- scraper runs ---

  startRun(sourceId: string): Promise<ScraperRunStartResponse> {
    return this.http.post('/internal/scraper/runs', { sourceId })
  }

  completeRun(body: ScraperRunCompleteRequest): Promise<void> {
    return this.http.post('/internal/scraper/runs/complete', body)
  }

  failRun(body: ScraperRunFailRequest): Promise<void> {
    return this.http.post('/internal/scraper/runs/fail', body)
  }

  // --- sources ---

  getSourceProfile(sourceId: string): Promise<SourceProfile> {
    return this.http.get(`/internal/scraper/sources/${sourceId}/profile`)
  }

  getExecutionState(sourceId: string): Promise<SourceExecutionStateResponse> {
    return this.http.get(`/internal/scraper/sources/${sourceId}/execution-state`)
  }

  markNeedsRemapping(sourceId: string, errorMessage?: string): Promise<void> {
    return this.http.post('/internal/scraper/sources/needs-remapping', { sourceId, errorMessage })
  }

  markActive(
    sourceId: string,
    data: { listingCount: number; fingerprintHash: string; page1Hash?: string; isCompleteCrawl: boolean },
  ): Promise<void> {
    return this.http.post('/internal/scraper/sources/active', { sourceId, ...data })
  }

  markChecked(sourceId: string): Promise<void> {
    return this.http.post('/internal/scraper/sources/checked', { sourceId })
  }

  markError(sourceId: string, errorMessage: string): Promise<void> {
    return this.http.post('/internal/scraper/sources/error', { sourceId, errorMessage })
  }

  markPaused(sourceId: string, reason: string): Promise<void> {
    return this.http.post('/internal/scraper/sources/paused', { sourceId, reason })
  }

  getMappings(sourceId: string): Promise<SourceMappingsResponse> {
    return this.http.get(`/internal/scraper/sources/${sourceId}/mappings`)
  }

  setMappings(sourceId: string, mappings: FieldMapping[]): Promise<void> {
    return this.http.post('/internal/scraper/sources/mappings', { sourceId, mappings })
  }

  getLastFullCrawlAt(sourceId: string): Promise<{ lastFullCrawlAt: string | null }> {
    return this.http.get(`/internal/scraper/sources/${sourceId}/last-full-crawl-at`)
  }

  getDriftBaseline(sourceId: string): Promise<{ baseline: SourceDriftBaseline | null }> {
    return this.http.get(`/internal/scraper/sources/${sourceId}/drift-baseline`)
  }

  setDriftBaseline(sourceId: string, baseline: SourceDriftBaseline): Promise<void> {
    return this.http.post('/internal/scraper/sources/drift-baseline', { sourceId, baseline })
  }

  // --- listing ingest (source-scrape) ---

  upsertListing(body: ListingUpsertRequest): Promise<ListingUpsertResponse> {
    return this.http.post('/internal/scraper/listings/upsert', body)
  }

  markGone(
    sourceId: string,
    body: { scraperRunId: string; activeSourceRecordKeys: string[]; isCompleteCrawl: boolean },
  ): Promise<ListingMarkGoneResponse> {
    return this.http.post(`/internal/scraper/sources/${sourceId}/listings/mark-gone`, {
      sourceId,
      ...body,
    })
  }

  // --- detail-crawl ---

  getDetailCrawlPendingListings(
    sourceId: string,
    limit?: number,
  ): Promise<DetailCrawlPendingListingsResponse> {
    return this.http.post('/internal/scraper/detail-crawl/pending-listings', { sourceId, limit })
  }

  upsertRawPage(sourceId: string, url: string, html: string): Promise<RawPageUpsertResponse> {
    return this.http.post('/internal/scraper/raw-pages/upsert', { sourceId, url, html })
  }

  markGoneByUrl(sourceUrl: string): Promise<ListingMarkGoneByUrlResponse> {
    return this.http.post('/internal/scraper/listings/mark-gone-by-url', { sourceUrl })
  }

  // --- detail-extract ---

  getDetailExtractPendingRawPages(
    sourceId: string,
    limit?: number,
  ): Promise<DetailExtractPendingRawPagesResponse> {
    return this.http.post('/internal/scraper/detail-extract/pending-raw-pages', { sourceId, limit })
  }

  getListingBySourceUrl(sourceUrl: string): Promise<ListingBySourceUrlResponse> {
    return this.http.post('/internal/scraper/listings/by-source-url', { sourceUrl })
  }

  submitDetailExtract(body: DetailExtractSubmitRequest): Promise<DetailExtractSubmitResponse> {
    return this.http.post('/internal/scraper/detail-extract/submit', body)
  }

  markRawPageProcessed(rawPageId: string): Promise<void> {
    return this.http.post('/internal/scraper/raw-pages/mark-processed', { rawPageId })
  }

  // --- worker gateway HTTP completion callback ---

  completeJob(body: {
    correlationId: string
    success: boolean
    errorMessage?: string
    result?: unknown
  }): Promise<{ acknowledged: boolean }> {
    return this.http.post('/internal/workers/jobs/complete', body)
  }
}
