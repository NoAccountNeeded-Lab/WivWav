/**
 * Consumes `listing-resolve` jobs (#634): the operational handoff from detail
 * extraction and source scraping that drains listings sitting at
 * `publicationStatus: pending` into a deterministic `eligible`/`quarantined`
 * decision using the current validator policy (#502). Preserves #499 as the
 * owner of the larger persisted-claims/conflict-resolution model — this job
 * only applies the existing deterministic validator, it does not implement
 * photo claims or multi-source identity conflict handling.
 *
 * Two payload shapes are produced upstream:
 * - `{ sourceId }` from a source scrape whose card changes invalidated one or
 *   more listings (apps/scraper/src/index.ts). Drains every currently-pending,
 *   non-gone listing for that source, cursor-paginated in bounded pages so a
 *   large backlog never sits in one unbounded query or transaction.
 * - `{ listingId, observationReference }` from detail extraction when an
 *   accessibility field changed (apps/scraper/src/jobs/detail-extract.ts).
 *   Resolves exactly that one listing.
 *
 * Staleness/idempotency: resolution always re-reads the current row from
 * Postgres rather than trusting the payload's snapshot, and writes the
 * decision with an optimistic-concurrency guard (`where: { id, updatedAt }`).
 * If a newer write (e.g. a subsequent detail extraction) lands between the
 * read and the write, the guarded update matches zero rows (Prisma P2025) and
 * is treated as a benign skip rather than an error — the newer writer's
 * decision already reflects current state and must not be clobbered by a
 * stale one. This also makes retries idempotent: re-running this job for an
 * already-resolved listing re-derives the same decision from current data.
 * The source-scoped drain paginates by cursor rather than re-querying
 * `publicationStatus: pending` from scratch each page, so a listing that
 * repeatedly loses this race cannot occupy the head of the result set forever
 * and stall the rest of the backlog.
 *
 * This job writes decisions to Postgres only. Search-index sync is not its
 * concern — the single-owner indexer poller (#669) picks up every touched
 * listing (via `updatedAt`) on its next tick.
 */
import { getDb, Prisma, type Listing as PrismaListing, type PrismaClient } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { validateListing, decidePublication } from '../engine/listing-validator.js'
import type { ListingUpsertData } from '../engine/repositories.js'
import { report } from './job-progress.js'

export type ListingResolveJobData =
  | { sourceId: string }
  | { listingId: string; observationReference: string }

const SOURCE_BATCH_SIZE = 100

export type ResolveOutcome = 'eligible' | 'quarantined' | 'skipped-stale'

/** Maps a full Prisma listing row to the nested shape validateListing() requires. */
export function toValidatorInput(row: PrismaListing): ListingUpsertData {
  return {
    sourceId: row.sourceId,
    sourceUrl: row.sourceUrl,
    buyerUrl: row.buyerUrl,
    externalId: row.externalId,
    stockNumber: row.stockNumber,
    sourceRecordKey: row.sourceRecordKey,
    make: row.make,
    model: row.model,
    year: row.year,
    trim: row.trim,
    vin: row.vin,
    condition: row.condition,
    sellerType: row.sellerType,
    priceCents: row.priceCents,
    mileage: row.mileage,
    color: row.color,
    fuelType: row.fuelType,
    transmission: row.transmission,
    wav: {
      conversionType: row.conversionType,
      conversionManufacturer: row.conversionManufacturer,
      floorLoweringInches: row.floorLoweringInches,
      rampType: row.rampType,
      conversionStatus: row.conversionStatus,
      wavFeatures: row.wavFeatures,
      wheelchairCapacity: row.wheelchairCapacity,
    },
    location: { zip: row.zip, city: row.city, state: row.state, lat: row.lat, lng: row.lng },
    dealer: { name: row.dealerName, phone: row.dealerPhone, website: row.dealerWebsite },
    images: row.images,
    description: row.description,
    saleStatus: row.saleStatus,
    soldAt: row.soldAt,
    listedAt: row.listedAt,
  }
}

function isRecordNotFoundError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'
}

/**
 * Re-validates one listing against current data and writes the decision.
 * Does not sync to Meilisearch — callers batch the sync across everything
 * they touched in one pass instead of one Meilisearch round-trip per row.
 */
export async function resolveRow(
  db: PrismaClient,
  row: PrismaListing,
  context: JobContext | undefined,
): Promise<ResolveOutcome> {
  const issues = validateListing(toValidatorInput(row))
  const decision = decidePublication(issues)

  try {
    await db.listing.update({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: {
        publicationStatus: decision.publicationStatus,
        qualityIssueCodes: decision.qualityIssueCodes,
        qualityCheckedAt: new Date(),
      },
    })
  } catch (err) {
    if (isRecordNotFoundError(err)) {
      await report(
        context,
        `[listing-resolve] Listing ${row.id} changed concurrently — skipping stale decision`,
      )
      return 'skipped-stale'
    }
    throw err
  }

  return decision.publicationStatus
}

async function resolveOneListing(
  db: PrismaClient,
  listingId: string,
  observationReference: string,
  context: JobContext | undefined,
): Promise<void> {
  const row = await db.listing.findUnique({ where: { id: listingId, status: { not: 'gone' } } })
  if (!row) {
    await report(context, `[listing-resolve] Listing ${listingId} no longer exists or is gone — skipping`)
    return
  }

  const outcome = await resolveRow(db, row, context)
  await report(
    context,
    `[listing-resolve] Listing ${listingId} (observation ${observationReference}): ${outcome}`,
    { stage: 'complete', current: 1, total: 1 },
  )
}

/**
 * Drains every currently-pending listing for a source in bounded pages.
 * Pages are cursor-paginated (not re-queried from scratch) so a listing that
 * repeatedly loses the optimistic-concurrency race — and so stays 'pending' —
 * cannot occupy the head of the result set forever and stall the drain; the
 * cursor always advances past it.
 */
async function resolveSourceBacklog(
  db: PrismaClient,
  sourceId: string,
  context: JobContext | undefined,
): Promise<void> {
  let processed = 0
  let resolved = 0
  let skippedStale = 0
  let cursor: string | undefined

  for (;;) {
    const rows = await db.listing.findMany({
      where: { sourceId, publicationStatus: 'pending', status: { not: 'gone' } },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      take: SOURCE_BATCH_SIZE,
      orderBy: { id: 'asc' },
    })
    if (rows.length === 0) break

    for (const row of rows) {
      const outcome = await resolveRow(db, row, context)
      processed++
      if (outcome === 'skipped-stale') skippedStale++
      else resolved++
    }

    cursor = rows[rows.length - 1]!.id
    await report(
      context,
      `[listing-resolve] source ${sourceId}: processed ${processed} (resolved ${resolved}, skipped ${skippedStale})`,
    )

    if (rows.length < SOURCE_BATCH_SIZE) break
  }

  await report(context, `[listing-resolve] source ${sourceId}: done. ${processed} processed.`, {
    stage: 'complete',
    current: processed,
    total: processed,
  })
}

export async function runListingResolveJob(
  data: ListingResolveJobData,
  context?: JobContext,
): Promise<void> {
  const db = getDb()

  try {
    if ('listingId' in data) {
      await resolveOneListing(db, data.listingId, data.observationReference, context)
    } else {
      await resolveSourceBacklog(db, data.sourceId, context)
    }
  } finally {
    await db.$disconnect()
  }
}
