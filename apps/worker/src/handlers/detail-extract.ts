import { report } from '@wivwav/scraper-sources'
import type { BrowserPage, BrowserService } from '@wivwav/scraper-sources/browser/types.js'
import {
  evaluateBlvdDetail,
  parseBlvdDetail,
  type RawDetail as RawBlvdDetail,
} from '@wivwav/scraper-sources/sources/blvd-detail.js'
import { evaluateMwDetail, parseMwDetail } from '@wivwav/scraper-sources/sources/mobilityworks-detail.js'
import {
  evaluateDeclarativeDetail,
  parseDeclarativeDetail,
} from '@wivwav/scraper-sources/sources/declarative-detail.js'
import {
  evaluateSourceListingDates,
  type SourceListingIdentity,
} from '@wivwav/scraper-sources/sources/source-listing-dates.js'
import {
  createRateLimitedFetcher,
  enrichBlvdDealerListing,
  fetchHtml,
} from '@wivwav/scraper-sources/sources/blvd-dealer-enrichment.js'
import type { FieldMapping } from '@wivwav/types'
import type { DetailResult } from '@wivwav/types/scraper-gateway'
import type { WivWavLogger } from '@wivwav/logger'
import type { ScraperGatewayClient } from '../scraper-gateway-client.js'
import { createJobContext } from '../job-context.js'

const BATCH_SIZE = 100
const BLVD_DETAIL_DOMAIN = 'blvd.com'
const MOBILITYWORKS_DETAIL_DOMAIN = 'mobilityworks.com'

export interface DetailExtractPayload {
  sourceId: string
}

function isDetailExtractPayload(payload: unknown): payload is DetailExtractPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as Record<string, unknown>)['sourceId'] === 'string'
  )
}

/**
 * Fallback DetailResult for a raw page whose URL matches neither a
 * bespoke-parser domain nor a source with configured mappings.
 */
function emptyDetailResult(sourceDates: {
  sourceListedAt: Date | null
  sourceUpdatedAt: Date | null
}): DetailResult {
  return {
    color: null,
    fuelType: null,
    engine: null,
    transmission: null,
    rampType: 'unknown',
    conversionType: 'unknown',
    wavFeatures: [],
    floorLoweringInches: null,
    wheelchairCapacity: null,
    description: null,
    images: [],
    zip: null,
    dealerPhone: null,
    saleStatus: 'active',
    sourceListedAt: sourceDates.sourceListedAt,
    sourceUpdatedAt: sourceDates.sourceUpdatedAt,
    evidence: {
      color: 'missing',
      fuelType: 'missing',
      engine: 'missing',
      transmission: 'missing',
      description: 'missing',
      images: 'missing',
      accessibilityClaims: 'missing',
    },
  }
}

/** Builds the BLVD-branch evidence record from raw extraction output. */
function blvdEvidence(raw: RawBlvdDetail): DetailResult['evidence'] {
  const description = raw.descriptionText.trim().length > 0 ? 'value' : 'missing'
  return {
    color: Object.hasOwn(raw.specs, 'Color') ? 'value' : 'missing',
    fuelType: 'missing',
    engine: Object.hasOwn(raw.specs, 'Engine') ? 'value' : 'missing',
    transmission: Object.hasOwn(raw.specs, 'Transmission') ? 'value' : 'missing',
    description,
    images: raw.galleryFound
      ? raw.imageUrls.length > 0
        ? 'value'
        : 'authoritative_empty'
      : 'missing',
    accessibilityClaims: description,
  }
}

async function extractDetail(
  page: BrowserPage,
  identity: SourceListingIdentity,
  mappings: FieldMapping[],
): Promise<DetailResult> {
  const sourceDates = await evaluateSourceListingDates(page, identity)
  if (identity.expectedUrl.includes(MOBILITYWORKS_DETAIL_DOMAIN)) {
    const raw = await evaluateMwDetail(page)
    const mw = parseMwDetail(raw)
    const description = raw.descriptionFound
      ? raw.descriptionText.trim().length > 0
        ? 'value'
        : 'authoritative_empty'
      : 'missing'
    return {
      ...mw,
      engine: null,
      ...sourceDates,
      evidence: {
        color:
          Object.hasOwn(raw.specs, 'Exterior Color') || Object.hasOwn(raw.specs, 'Color')
            ? 'value'
            : 'missing',
        fuelType: Object.hasOwn(raw.specs, 'Fuel Type') ? 'value' : 'missing',
        engine: 'missing',
        transmission: Object.hasOwn(raw.specs, 'Transmission') ? 'value' : 'missing',
        description,
        images: raw.galleryFound
          ? raw.imageUrls.length > 0
            ? 'value'
            : 'authoritative_empty'
          : 'missing',
        accessibilityClaims: description === 'missing' ? 'missing' : 'value',
      },
    }
  }
  if (identity.expectedUrl.includes(BLVD_DETAIL_DOMAIN)) {
    const raw = await evaluateBlvdDetail(page)
    return {
      ...parseBlvdDetail(raw),
      ...sourceDates,
      evidence: blvdEvidence(raw),
    }
  }
  if (mappings.length > 0) {
    const raw = await evaluateDeclarativeDetail(page, mappings)
    return {
      ...parseDeclarativeDetail(raw, mappings),
      ...sourceDates,
    }
  }
  return emptyDetailResult(sourceDates)
}

/**
 * DETAIL_EXTRACT handler (#952): ported from
 * `apps/scraper/src/jobs/detail-extract.ts`. Unlike the in-process job, this
 * worker does NOT compute the status transition, changed-field diff, or
 * observation row itself — the coordinator's `/detail-extract/submit`
 * endpoint derives all of that server-side from the extracted `DetailResult`
 * (see scraper-gateway.ts's docstring on `detailExtractSubmitRequestSchema`).
 * The worker's job is narrower: parse the raw page and submit.
 */
export function createDetailExtractHandler(
  gateway: ScraperGatewayClient,
  browserService: BrowserService,
  logger: WivWavLogger,
) {
  return async (payload: unknown, correlationId: string): Promise<void> => {
    if (!isDetailExtractPayload(payload)) {
      throw new Error('[detail-extract] payload must be { sourceId: string }')
    }
    const { sourceId } = payload
    const context = createJobContext(logger, correlationId)

    const { state } = await gateway.getExecutionState(sourceId)
    const blockReason = state && (state.status === 'disabled' || state.status === 'paused')
      ? state.errorMessage ?? `Source is ${state.status}`
      : null
    if (blockReason !== null) {
      await report(context, `[detail-extract] Skipped source ${sourceId}: ${blockReason}`, {
        stage: 'blocked',
        reason: 'source_disabled',
        current: 0,
        total: 0,
      })
      return
    }

    const { rawPages } = await gateway.getDetailExtractPendingRawPages(sourceId, BATCH_SIZE)
    if (rawPages.length === 0) {
      await report(context, `[detail-extract] No raw pages pending for source ${sourceId}`, {
        stage: 'complete',
        current: 0,
        total: 0,
      })
      return
    }

    await report(context, `[detail-extract] Extracting ${rawPages.length} raw pages for source ${sourceId}`, {
      stage: 'extracting',
      current: 0,
      total: rawPages.length,
    })

    const { mappings } = await gateway.getMappings(sourceId)
    const browser = await browserService.launch()
    const fetchDealerPage = createRateLimitedFetcher(fetchHtml)
    let success = 0
    let failed = 0

    try {
      for (let i = 0; i < rawPages.length; i++) {
        const { state: midRunState } = await gateway.getExecutionState(sourceId)
        const midRunBlockReason = midRunState && (midRunState.status === 'disabled' || midRunState.status === 'paused')
          ? midRunState.errorMessage ?? `Source is ${midRunState.status}`
          : null
        if (midRunBlockReason !== null) {
          await report(context, `[detail-extract] Stopped source ${sourceId}: ${midRunBlockReason}`, {
            stage: 'blocked',
            reason: 'source_disabled_mid_run',
            current: i,
            total: rawPages.length,
          })
          break
        }

        const rawPage = rawPages[i]!
        const page = await browser.newPage()

        try {
          const { listing } = await gateway.getListingBySourceUrl(rawPage.url)

          await page.setContent(rawPage.html, { waitUntil: 'domcontentloaded' })
          const sourceIdentifiers = [
            listing?.sourceRecordKey,
            listing?.externalId,
            listing?.stockNumber,
          ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

          const detail = await extractDetail(
            page,
            {
              expectedUrl: rawPage.url,
              expectedVin: listing?.vin ?? null,
              expectedSourceIdentifiers: sourceIdentifiers,
            },
            mappings,
          )

          const enrichment = await enrichBlvdDealerListing({
            sourceUrl: rawPage.url,
            vin: listing?.vin ?? null,
            fetchPage: fetchDealerPage,
            log: (message) => report(context, message),
          })

          if (listing === null) {
            await report(context, `[detail-extract] No listing found for URL: ${rawPage.url}`)
          }

          await gateway.submitDetailExtract({
            sourceId,
            rawPageId: rawPage.id,
            listingId: listing?.id ?? null,
            detail,
            enrichment,
            runId: context.runId ?? null,
          })

          success++
        } catch (err) {
          // Deliberately do NOT mark this raw page processed — it stays
          // eligible for the next scheduled run to retry.
          const message = err instanceof Error ? err.message : String(err)
          await report(context, `[detail-extract] Failed ${rawPage.url}: ${message}`)
          failed++
        } finally {
          await page.close()
        }

        await report(context, `[detail-extract] Processed ${i + 1}/${rawPages.length} raw page(s)`, {
          stage: 'extracting',
          current: i + 1,
          total: rawPages.length,
          success,
          failed,
        })
      }
    } finally {
      await browser.close()
    }

    await report(context, `[detail-extract] Done. ${success} extracted, ${failed} failed.`, {
      stage: 'complete',
      current: rawPages.length,
      total: rawPages.length,
      success,
      failed,
    })

    if (failed > 0) {
      const reason = `${failed} of ${rawPages.length} raw page(s) failed extraction for source ${sourceId} (${success} succeeded)`
      logger.error(
        { event: 'detail-extract.partial-failure', sourceId, success, failed, total: rawPages.length },
        `[detail-extract] ${reason}`,
      )
      throw new Error(`[detail-extract] ${reason}`)
    }
  }
}
