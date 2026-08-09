import type { FastifyPluginAsync } from 'fastify'
import {
  type Prisma,
  ingestListing,
  markGoneListings,
  recordCardFieldClaims,
  recordDetailFieldClaims,
  withTransientRetry,
  resolveListingStatus,
  buildListingDetailUpdateData,
  changedDetailFields,
  auditDetailValue,
  detailObservationReference,
  enqueueRequiredListingResolution,
  type PrismaClient,
} from '@wivwav/db'
import { CRITICAL_JOB_OPTIONS, type QueueFactory, QUEUES } from '@wivwav/queue'
import {
  scraperRunStartRequestSchema,
  scraperRunCompleteRequestSchema,
  scraperRunFailRequestSchema,
  sourceMarkNeedsRemappingRequestSchema,
  sourceMarkActiveRequestSchema,
  sourceMarkCheckedRequestSchema,
  sourceMarkErrorRequestSchema,
  sourceMarkPausedRequestSchema,
  sourceSetMappingsRequestSchema,
  sourceSetDriftBaselineRequestSchema,
  listingUpsertRequestSchema,
  listingMarkGoneRequestSchema,
  detailCrawlPendingListingsRequestSchema,
  rawPageUpsertRequestSchema,
  listingMarkGoneByUrlRequestSchema,
  rawPageMarkProcessedRequestSchema,
  detailExtractPendingRawPagesRequestSchema,
  listingBySourceUrlRequestSchema,
  detailExtractSubmitRequestSchema,
} from '@wivwav/types/scraper-gateway'
import type { WivWavLogger } from '@wivwav/logger'
import { ScraperRunGatewayRepository } from '../repositories/scraper-gateway/scraper-run-gateway-repository.js'
import { SourceGatewayRepository } from '../repositories/scraper-gateway/source-gateway-repository.js'

const DETAIL_CRAWL_BATCH_SIZE = 50
const DETAIL_CRAWL_STALE_DETAIL_DAYS = 30
const DETAIL_EXTRACT_BATCH_SIZE = 100

export interface InternalScraperRoutesOptions {
  db: PrismaClient
  queueFactory: QueueFactory
  logger?: WivWavLogger
}

/**
 * HTTP ingest surface for remote workers (#948/#951): every read/write a
 * worker needs for the three phase-1 jobs, ported from apps/scraper's
 * in-process repositories/jobs. Mounted at `/internal/scraper`, guarded by
 * the same fail-closed bearer auth as every other `/internal/*` scope (see
 * app.ts). Deliberately separate repository classes from the admin-facing
 * ones in ../repositories/ — same tables, different surface.
 *
 * Idempotency: /listings/upsert and /detail-extract/submit are idempotent by
 * construction (see ingestListing / the alreadyApplied check below); a
 * repeated /sources/:id/listings/mark-gone for the same scraperRunId replays
 * the stored result instead of double-incrementing missingFromCompleteCount
 * (see the ScraperRun.markGoneAppliedAt marker).
 */
export const internalScraperRoutes: FastifyPluginAsync<InternalScraperRoutesOptions> = async (
  app,
  { db, queueFactory, logger },
) => {
  const scraperRuns = new ScraperRunGatewayRepository(db)
  const sources = new SourceGatewayRepository(db, logger)
  const resolutionQueue = queueFactory.createQueue(QUEUES.LISTING_RESOLVE)

  // --- scraper runs ---

  app.post('/runs', async (req, reply) => {
    const body = scraperRunStartRequestSchema.parse(req.body)
    const run = await scraperRuns.start(body.sourceId)
    return reply.send({ data: run })
  })

  app.post('/runs/complete', async (req, reply) => {
    const body = scraperRunCompleteRequestSchema.parse(req.body)
    await scraperRuns.complete(body.runId, body.listingsFound, body.changes)
    return reply.send({ data: { ok: true } })
  })

  app.post('/runs/fail', async (req, reply) => {
    const body = scraperRunFailRequestSchema.parse(req.body)
    await scraperRuns.fail(body.runId, body.errorMessage)
    return reply.send({ data: { ok: true } })
  })

  // --- sources ---

  app.get<{ Params: { id: string } }>('/sources/:id/execution-state', async (req, reply) => {
    const state = await sources.getExecutionState(req.params.id)
    return reply.send({ data: { state } })
  })

  // #952: a remote worker's SOURCE_SCRAPE dispatch carries only `sourceId` —
  // this returns the name/baseUrl/fingerprintHash/page1Hash it needs to
  // resolve the registry adapter module and seed change-detection state.
  app.get<{ Params: { id: string } }>('/sources/:id/profile', async (req, reply) => {
    const profile = await sources.getProfile(req.params.id)
    if (!profile) return reply.notFound(`source ${req.params.id} not found`)
    return reply.send({ data: profile })
  })

  app.post('/sources/needs-remapping', async (req, reply) => {
    const body = sourceMarkNeedsRemappingRequestSchema.parse(req.body)
    await sources.markNeedsRemapping(body.sourceId, body.errorMessage)
    return reply.send({ data: { ok: true } })
  })

  app.post('/sources/active', async (req, reply) => {
    const body = sourceMarkActiveRequestSchema.parse(req.body)
    await sources.markActive(body.sourceId, {
      listingCount: body.listingCount,
      fingerprintHash: body.fingerprintHash,
      page1Hash: body.page1Hash,
      isCompleteCrawl: body.isCompleteCrawl,
    })
    return reply.send({ data: { ok: true } })
  })

  app.post('/sources/checked', async (req, reply) => {
    const body = sourceMarkCheckedRequestSchema.parse(req.body)
    await sources.markChecked(body.sourceId)
    return reply.send({ data: { ok: true } })
  })

  app.post('/sources/error', async (req, reply) => {
    const body = sourceMarkErrorRequestSchema.parse(req.body)
    await sources.markError(body.sourceId, body.errorMessage)
    return reply.send({ data: { ok: true } })
  })

  app.post('/sources/paused', async (req, reply) => {
    const body = sourceMarkPausedRequestSchema.parse(req.body)
    await sources.markPaused(body.sourceId, body.reason)
    return reply.send({ data: { ok: true } })
  })

  app.get<{ Params: { id: string } }>('/sources/:id/mappings', async (req, reply) => {
    const mappings = await sources.getMappings(req.params.id)
    return reply.send({ data: { mappings } })
  })

  app.post('/sources/mappings', async (req, reply) => {
    const body = sourceSetMappingsRequestSchema.parse(req.body)
    await sources.setMappings(body.sourceId, body.mappings)
    return reply.send({ data: { ok: true } })
  })

  app.get<{ Params: { id: string } }>('/sources/:id/last-full-crawl-at', async (req, reply) => {
    const lastFullCrawlAt = await sources.getLastFullCrawlAt(req.params.id)
    return reply.send({ data: { lastFullCrawlAt } })
  })

  app.get<{ Params: { id: string } }>('/sources/:id/drift-baseline', async (req, reply) => {
    const baseline = await sources.getDriftBaseline(req.params.id)
    return reply.send({ data: { baseline } })
  })

  app.post('/sources/drift-baseline', async (req, reply) => {
    const body = sourceSetDriftBaselineRequestSchema.parse(req.body)
    await sources.setDriftBaseline(body.sourceId, body.baseline)
    return reply.send({ data: { ok: true } })
  })

  // --- listing ingest (source-scrape) ---

  app.post('/listings/upsert', async (req, reply) => {
    const body = listingUpsertRequestSchema.parse(req.body)
    const result = await withTransientRetry(() =>
      db.$transaction((tx) => ingestListing(tx, body), { isolationLevel: 'Serializable' }),
    )
    // #499: record whatever accessibility evidence the card observed, then
    // re-resolve. Its own transaction, after the upsert commits — mirrors
    // apps/scraper's card-claims.ts docstring. Short-circuits when the card
    // supplied no evidence this scrape (the common case).
    await recordCardFieldClaims(db, result.listingId, body, undefined, logger)
    return reply.send({ data: result })
  })

  app.post<{ Params: { sourceId: string } }>(
    '/sources/:sourceId/listings/mark-gone',
    async (req, reply) => {
      const body = listingMarkGoneRequestSchema.parse(req.body)
      if (body.sourceId !== req.params.sourceId) {
        return reply.badRequest('sourceId in the URL and body must match')
      }

      // Idempotency: a mark-gone HTTP retry for the same (sourceId,
      // scraperRunId) must not double-increment missingFromCompleteCount.
      // Marked at the ScraperRun row created by /runs — see the #948
      // markGoneAppliedAt migration. Read-check-write is done inside one
      // Serializable transaction, additionally guarded by a run-scoped
      // pg_advisory_xact_lock (same technique as claims-repository.ts's
      // recordClaim), so two genuinely concurrent retries for the same run —
      // not just sequential ones — serialize instead of both slipping past the
      // check before either has written the marker; and a crash between
      // applying markGoneListings and writing the marker rolls the whole
      // transaction back, leaving the retry free to run cleanly rather than
      // silently skipping work it never actually committed.
      const goneCount = await withTransientRetry(() =>
        db.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mark_gone:${body.scraperRunId}`}))`
            const run = await tx.scraperRun.findUnique({
              where: { id: body.scraperRunId },
              select: { markGoneAppliedAt: true, markGoneNewlyMissingCount: true },
            })
            if (run?.markGoneAppliedAt) return run.markGoneNewlyMissingCount ?? 0

            const count = await markGoneListings(tx, body.sourceId, body.activeSourceRecordKeys, {
              isCompleteCrawl: body.isCompleteCrawl,
              // The old in-process onGone search-index callback has no wire
              // equivalent — the single-owner LISTING_INDEX_POLL poller picks
              // up the status change via `updatedAt` on its next tick (matches
              // how the codebase already treats index sync post-#669).
            })
            await tx.scraperRun.update({
              where: { id: body.scraperRunId },
              data: { markGoneAppliedAt: new Date(), markGoneNewlyMissingCount: count },
            })
            return count
          },
          { isolationLevel: 'Serializable' },
        ),
      )
      return reply.send({ data: { goneCount } })
    },
  )

  // --- detail-crawl ---

  app.post('/detail-crawl/pending-listings', async (req, reply) => {
    const body = detailCrawlPendingListingsRequestSchema.parse(req.body)
    const staleThreshold = new Date(
      Date.now() - DETAIL_CRAWL_STALE_DETAIL_DAYS * 24 * 60 * 60 * 1000,
    )
    const listings = await db.listing.findMany({
      where: {
        sourceId: body.sourceId,
        status: { not: 'gone' },
        OR: [{ detailScrapedAt: null }, { detailScrapedAt: { lt: staleThreshold } }],
      },
      select: { sourceUrl: true, status: true },
      take: body.limit ?? DETAIL_CRAWL_BATCH_SIZE,
      orderBy: { listedAt: 'asc' },
    })
    return reply.send({ data: { listings } })
  })

  app.post('/raw-pages/upsert', async (req, reply) => {
    const body = rawPageUpsertRequestSchema.parse(req.body)
    const rawPage = await db.rawPage.upsert({
      where: { url: body.url },
      // Reset processedAt so the extract job re-processes on re-crawl.
      update: { html: body.html, scrapedAt: new Date(), processedAt: null },
      create: { url: body.url, sourceId: body.sourceId, html: body.html },
    })
    return reply.send({ data: { rawPageId: rawPage.id } })
  })

  app.post('/listings/mark-gone-by-url', async (req, reply) => {
    const body = listingMarkGoneByUrlRequestSchema.parse(req.body)
    // Authoritative gone signal from detail-crawl (404 / off-domain
    // redirect): marks every non-gone listing at this URL immediately,
    // without waiting for the extract stage.
    const result = await db.listing.updateMany({
      where: { sourceUrl: body.sourceUrl, status: { not: 'gone' } },
      data: { status: 'gone', goneAt: new Date() },
    })
    return reply.send({ data: { updatedCount: result.count } })
  })

  // --- detail-extract ---

  app.post('/detail-extract/pending-raw-pages', async (req, reply) => {
    const body = detailExtractPendingRawPagesRequestSchema.parse(req.body)
    const rawPages = await db.rawPage.findMany({
      where: { sourceId: body.sourceId, processedAt: null },
      select: { id: true, url: true, html: true, scrapedAt: true },
      take: body.limit ?? DETAIL_EXTRACT_BATCH_SIZE,
    })
    return reply.send({ data: { rawPages } })
  })

  app.post('/listings/by-source-url', async (req, reply) => {
    const body = listingBySourceUrlRequestSchema.parse(req.body)
    const listing = await db.listing.findFirst({
      where: { sourceUrl: body.sourceUrl },
      select: {
        id: true,
        sourceRecordKey: true,
        externalId: true,
        stockNumber: true,
        status: true,
        soldAt: true,
        vin: true,
        missingFromCompleteCount: true,
      },
    })
    return reply.send({ data: { listing } })
  })

  app.post('/detail-extract/submit', async (req, reply) => {
    const body = detailExtractSubmitRequestSchema.parse(req.body)
    // Independent reads (the listing lookup only depends on body.listingId,
    // already known from the parsed body) — run concurrently rather than
    // paying two sequential round trips on every submission.
    const [rawPage, listing] = await Promise.all([
      db.rawPage.findUnique({
        where: { id: body.rawPageId },
        select: { id: true, url: true, scrapedAt: true },
      }),
      body.listingId === null
        ? Promise.resolve(null)
        : db.listing.findUnique({
            where: { id: body.listingId },
            select: {
              id: true,
              status: true,
              soldAt: true,
              missingFromCompleteCount: true,
              color: true,
              fuelType: true,
              engine: true,
              transmission: true,
              rampType: true,
              wavFeatures: true,
              floorLoweringInches: true,
              wheelchairCapacity: true,
              description: true,
              images: true,
              zip: true,
              dealerPhone: true,
              dealerWebsite: true,
              buyerUrl: true,
              saleStatus: true,
              sourceListedAt: true,
              sourceUpdatedAt: true,
              goneAt: true,
              publicationStatus: true,
              qualityIssueCodes: true,
              qualityCheckedAt: true,
              detailScrapedAt: true,
              updatedAt: true,
            },
          }),
    ])
    if (!rawPage) return reply.notFound(`raw page ${body.rawPageId} not found`)

    const observationReference = detailObservationReference(rawPage)

    if (body.listingId === null) {
      await db.rawPage.update({ where: { id: rawPage.id }, data: { processedAt: new Date() } })
      return reply.send({ data: { outcome: 'listing_not_found', changedFields: [] } })
    }
    if (!listing) return reply.notFound(`listing ${body.listingId} not found`)

    // Retry idempotency: if this observation reference was already recorded
    // (a prior attempt committed the update but the worker's HTTP call was
    // retried before it saw the response), skip straight to that bookkeeping
    // rather than re-applying the detail update.
    const alreadyApplied = await db.listingObservation.findUnique({
      where: { stage_reference: { stage: 'detail', reference: observationReference } },
      select: { id: true, changedFields: true },
    })
    if (alreadyApplied) {
      await enqueueRequiredListingResolution(
        db,
        resolutionQueue,
        CRITICAL_JOB_OPTIONS,
        listing.id,
        observationReference,
        alreadyApplied.changedFields,
        body.runId,
      )
      await db.rawPage.update({ where: { id: rawPage.id }, data: { processedAt: new Date() } })
      return reply.send({
        data: { outcome: 'already_applied', changedFields: alreadyApplied.changedFields },
      })
    }

    const now = new Date()
    const statusUpdate = resolveListingStatus(
      listing.status,
      body.detail.saleStatus,
      listing.soldAt,
      now,
      listing.missingFromCompleteCount,
    )
    const update = buildListingDetailUpdateData(body.detail, body.enrichment, statusUpdate, now)
    const claimsObserved = body.detail.evidence.accessibilityClaims !== 'missing'
    const changedFields = changedDetailFields(listing as unknown as Record<string, unknown>, update)
    const before = Object.fromEntries(
      changedFields.map((field) => [
        field,
        auditDetailValue((listing as unknown as Record<string, unknown>)[field]),
      ]),
    )
    const after = Object.fromEntries(
      changedFields.map((field) => [
        field,
        auditDetailValue((update as Record<string, unknown>)[field]),
      ]),
    )

    // Serializable, matching detail-extract.ts's original transaction — same
    // pool-contention/transient-close hazard, same retry.
    await withTransientRetry(() =>
      db.$transaction(
        async (tx) => {
          await tx.listing.update({
            where: { id: listing.id, updatedAt: listing.updatedAt },
            data: changedFields.length > 0 ? update : { detailScrapedAt: now },
          })
          await tx.listingObservation.create({
            data: {
              listingId: listing.id,
              stage: 'detail',
              reference: observationReference,
              extractionVersion: 'detail-v2-evidence',
              changedFields,
              before: before as Prisma.InputJsonObject,
              after: after as Prisma.InputJsonObject,
              observedAt: now,
            },
          })
        },
        { isolationLevel: 'Serializable' },
      ),
    )

    await enqueueRequiredListingResolution(
      db,
      resolutionQueue,
      CRITICAL_JOB_OPTIONS,
      listing.id,
      observationReference,
      changedFields,
      body.runId,
    )

    // #499: record an independent detail-page claim for whatever
    // accessibility evidence this raw page actually observed, then
    // re-resolve. Gated on claimsObserved — a failed/absent extraction is
    // not a claim of "no evidence" and must not downgrade an existing
    // resolution.
    if (claimsObserved) {
      await recordDetailFieldClaims(
        db,
        listing.id,
        { conversionType: body.detail.conversionType, rampType: body.detail.rampType },
        rawPage.url,
        'detail-v2-evidence',
        undefined,
        logger,
      )
    }

    await db.rawPage.update({ where: { id: rawPage.id }, data: { processedAt: new Date() } })
    return reply.send({ data: { outcome: 'applied', changedFields } })
  })

  app.post('/raw-pages/mark-processed', async (req, reply) => {
    const body = rawPageMarkProcessedRequestSchema.parse(req.body)
    await db.rawPage.update({ where: { id: body.rawPageId }, data: { processedAt: new Date() } })
    return reply.send({ data: { ok: true } })
  })
}
