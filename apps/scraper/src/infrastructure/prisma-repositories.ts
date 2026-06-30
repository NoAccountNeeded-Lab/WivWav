import type { PrismaClient } from '@wivwav/db'
import type { FieldMapping } from '@wivwav/types'
import type {
  ScraperRunRepository,
  ScraperRunRecord,
  SourceRepository,
  ListingRepository,
  ListingUpsertData,
  ListingUpsertResult,
  MarkGoneOptions,
} from '../engine/repositories.js'
import { GONE_AFTER_CONSECUTIVE_MISSING } from '../engine/repositories.js'
import type { SourceDriftBaseline } from '../engine/listing-validator.js'

const TRANSIENT_PRISMA_CODES = new Set(['P2002', 'P2028', 'P2034', 'P1001', 'P1002', 'P1008', 'P1017'])
const TRANSIENT_DB_MESSAGES = ['connection closed', 'connection reset', 'transaction already closed']

/**
 * Returns true for Prisma errors that represent transient connection or transaction
 * failures that are safe to retry: concurrent create/write conflicts P2002/P2034,
 * P2028 (transaction already closed), and connection errors P1001/P1002/P1008/P1017.
 */
function isTransientPrismaError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  const code = (err as Record<string, unknown>)['code']
  if (typeof code === 'string' && TRANSIENT_PRISMA_CODES.has(code)) return true
  const message = (err as Record<string, unknown>)['message']
  if (typeof message === 'string') {
    const lower = message.toLowerCase()
    return TRANSIENT_DB_MESSAGES.some((fragment) => lower.includes(fragment))
  }
  return false
}

/**
 * Runs `fn` up to `maxAttempts` times, retrying only on transient Prisma errors.
 * Uses exponential backoff starting at `baseDelayMs`.
 */
async function withTransientRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 100,
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (err: unknown) {
      attempt++
      if (!isTransientPrismaError(err) || attempt >= maxAttempts) throw err
      await new Promise<void>((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)))
    }
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false

  const normalizedLeft = [...left].sort()
  const normalizedRight = [...right].sort()
  return normalizedLeft.every((value, index) => value === normalizedRight[index])
}

function sourceObservation(listing: ListingUpsertData, buyerUrl: string | null) {
  return {
    sourceUrl: listing.sourceUrl,
    buyerUrl,
    externalId: listing.externalId,
    stockNumber: listing.stockNumber,
    make: listing.make,
    model: listing.model,
    year: listing.year,
    trim: listing.trim,
    vin: listing.vin,
    condition: listing.condition,
    sellerType: listing.sellerType,
    priceCents: listing.priceCents,
    mileage: listing.mileage,
    color: listing.color,
    conversionType: listing.wav.conversionType,
    conversionManufacturer: listing.wav.conversionManufacturer,
    floorLoweringInches: listing.wav.floorLoweringInches,
    rampType: listing.wav.rampType,
    conversionStatus: listing.wav.conversionStatus,
    wavFeatures: listing.wav.wavFeatures,
    wheelchairCapacity: listing.wav.wheelchairCapacity,
    zip: listing.location.zip,
    city: listing.location.city,
    state: listing.location.state,
    dealerName: listing.dealer.name,
    cardImages: listing.images,
    qualityIssueCodes: listing.qualityIssueCodes ?? [],
    status: 'active',
  }
}

export class PrismaScraperRunRepository implements ScraperRunRepository {
  constructor(private readonly db: PrismaClient) {}

  async start(sourceId: string): Promise<ScraperRunRecord> {
    return this.db.scraperRun.create({ data: { sourceId, startedAt: new Date() } })
  }

  async complete(
    id: string,
    listingsFound: number,
    changes: { listingsNew: number; listingsUpdated: number } = { listingsNew: 0, listingsUpdated: 0 },
  ): Promise<void> {
    await this.db.scraperRun.update({
      where: { id },
      data: { finishedAt: new Date(), success: true, listingsFound, ...changes },
    })
  }

  async fail(id: string, errorMessage: string): Promise<void> {
    await this.db.scraperRun.update({
      where: { id },
      data: { finishedAt: new Date(), success: false, errorMessage },
    })
  }
}

export class PrismaSourceRepository implements SourceRepository {
  constructor(private readonly db: PrismaClient) {}

  async markNeedsRemapping(id: string, errorMessage = 'Structure changed — awaiting AI remap'): Promise<void> {
    await this.db.source.update({
      where: { id },
      data: { status: 'needs_remapping', errorMessage },
    })
  }

  async markActive(id: string, data: { listingCount: number; fingerprintHash: string; page1Hash?: string; isCompleteCrawl: boolean }): Promise<void> {
    const now = new Date()
    await this.db.source.update({
      where: { id },
      data: {
        lastScrapedAt: now,
        lastObservedAt: now,
        listingCount: data.listingCount,
        fingerprintHash: data.fingerprintHash,
        ...(data.page1Hash !== undefined ? { page1Hash: data.page1Hash } : {}),
        ...(data.isCompleteCrawl ? { lastFullCrawlAt: now } : {}),
        status: 'active',
        errorMessage: null,
      },
    })
  }

  async markChecked(id: string): Promise<void> {
    const now = new Date()
    await this.db.source.update({ where: { id }, data: { lastCheckedAt: now, lastObservedAt: now } })
    // Reset error status when a no-change check succeeds — the source is reachable
    await this.db.source.updateMany({ where: { id, status: 'error' }, data: { status: 'active', errorMessage: null } })
  }

  async markError(id: string, errorMessage: string): Promise<void> {
    await this.db.source.update({
      where: { id },
      data: { status: 'error', errorMessage },
    })
  }

  async markPaused(id: string, reason: string): Promise<void> {
    await this.db.source.update({
      where: { id },
      data: { status: 'paused', errorMessage: reason },
    })
  }

  async getDriftBaseline(id: string): Promise<SourceDriftBaseline> {
    const source = await this.db.source.findUnique({
      where: { id },
      select: { baselineErrorRate: true, baselineMissingRate: true },
    })
    return {
      baselineErrorRate: source?.baselineErrorRate ?? 0,
      baselineMissingRate: source?.baselineMissingRate ?? 0,
    }
  }

  async setDriftBaseline(id: string, baseline: SourceDriftBaseline): Promise<void> {
    await this.db.source.update({
      where: { id },
      data: {
        baselineErrorRate: baseline.baselineErrorRate,
        baselineMissingRate: baseline.baselineMissingRate,
      },
    })
  }

  async getMappings(id: string): Promise<FieldMapping[]> {
    const source = await this.db.source.findUnique({ where: { id }, select: { mappings: true } })
    return (source?.mappings ?? []) as unknown as FieldMapping[]
  }

  async setMappings(id: string, mappings: FieldMapping[]): Promise<void> {
    // Prisma's Json type needs the double cast via unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.source.update({ where: { id }, data: { mappings: mappings as unknown as any } })
  }

  async getLastFullCrawlAt(id: string): Promise<Date | null> {
    const source = await this.db.source.findUnique({ where: { id }, select: { lastFullCrawlAt: true } })
    return source?.lastFullCrawlAt ?? null
  }
}

export class PrismaListingRepository implements ListingRepository {
  constructor(private readonly db: PrismaClient) {}

  async upsert(listing: ListingUpsertData): Promise<ListingUpsertResult> {
    return withTransientRetry(() => this.db.$transaction(async (tx) => {
      const existing = await tx.listing.findUnique({
        where: {
          sourceId_sourceRecordKey: {
            sourceId: listing.sourceId,
            sourceRecordKey: listing.sourceRecordKey,
          },
        },
        select: {
          id: true,
          sourceUrl: true,
          buyerUrl: true,
          externalId: true,
          stockNumber: true,
          make: true,
          model: true,
          year: true,
          trim: true,
          vin: true,
          condition: true,
          sellerType: true,
          priceCents: true,
          mileage: true,
          color: true,
          conversionType: true,
          conversionManufacturer: true,
          floorLoweringInches: true,
          rampType: true,
          conversionStatus: true,
          wavFeatures: true,
          wheelchairCapacity: true,
          zip: true,
          city: true,
          state: true,
          dealerName: true,
          cardImages: true,
          qualityIssueCodes: true,
          status: true,
        },
      })

      const buyerUrl =
        existing?.buyerUrl && existing.buyerUrl !== existing.sourceUrl && listing.buyerUrl === listing.sourceUrl
          ? existing.buyerUrl
          : listing.buyerUrl
      const after = sourceObservation(listing, buyerUrl)

      if (existing === null) {
        const created = await tx.listing.create({ data: {
        sourceId: listing.sourceId,
        sourceUrl: listing.sourceUrl,
        buyerUrl: listing.buyerUrl,
        externalId: listing.externalId,
        stockNumber: listing.stockNumber,
        sourceRecordKey: listing.sourceRecordKey,
        make: listing.make,
        model: listing.model,
        year: listing.year,
        trim: listing.trim,
        vin: listing.vin,
        condition: listing.condition,
        sellerType: listing.sellerType,
        priceCents: listing.priceCents,
        mileage: listing.mileage,
        color: listing.color,
        fuelType: listing.fuelType,
        transmission: listing.transmission,
        conversionType: listing.wav.conversionType,
        conversionManufacturer: listing.wav.conversionManufacturer,
        floorLoweringInches: listing.wav.floorLoweringInches,
        rampType: listing.wav.rampType,
        conversionStatus: listing.wav.conversionStatus,
        wavFeatures: listing.wav.wavFeatures,
        wheelchairCapacity: listing.wav.wheelchairCapacity,
        zip: listing.location.zip,
        city: listing.location.city,
        state: listing.location.state,
        lat: listing.location.lat,
        lng: listing.location.lng,
        dealerName: listing.dealer.name,
        dealerPhone: listing.dealer.phone,
        dealerWebsite: listing.dealer.website,
        cardImages: listing.images,
        images: listing.images,
        description: listing.description,
        qualityIssueCodes: listing.qualityIssueCodes ?? [],
        publicationStatus: listing.publicationStatus ?? 'pending',
        qualityCheckedAt: listing.qualityCheckedAt ?? null,
        listedAt: listing.listedAt,
        ...(listing.priceCents != null
          ? { priceHistory: { create: { priceCents: listing.priceCents } } }
          : {}),
        ...(listing.mileage != null
          ? { mileageHistory: { create: { mileage: listing.mileage } } }
          : {}),
        conversionHistory: {
          create: {
            conversionStatus: listing.wav.conversionStatus,
            wavFeatures: listing.wav.wavFeatures,
          },
        },
        } })
        await tx.listingObservation.create({
          data: {
            listingId: created.id,
            stage: 'list_card',
            extractionVersion: 'source-card-v1',
            changedFields: Object.keys(after),
            before: {},
            after,
          },
        })
        return { listingId: created.id, outcome: 'created', changedFields: Object.keys(after) }
      }

      const before = {
        sourceUrl: existing.sourceUrl,
        buyerUrl: existing.buyerUrl,
        externalId: existing.externalId,
        stockNumber: existing.stockNumber,
        make: existing.make,
        model: existing.model,
        year: existing.year,
        trim: existing.trim,
        vin: existing.vin,
        condition: existing.condition,
        sellerType: existing.sellerType,
        priceCents: existing.priceCents,
        mileage: existing.mileage,
        color: existing.color,
        conversionType: existing.conversionType,
        conversionManufacturer: existing.conversionManufacturer,
        floorLoweringInches: existing.floorLoweringInches,
        rampType: existing.rampType,
        conversionStatus: existing.conversionStatus,
        wavFeatures: existing.wavFeatures,
        wheelchairCapacity: existing.wheelchairCapacity,
        zip: existing.zip,
        city: existing.city,
        state: existing.state,
        dealerName: existing.dealerName,
        cardImages: existing.cardImages,
        qualityIssueCodes: existing.qualityIssueCodes,
        status: existing.status,
      }
      const changedFields = Object.keys(after).filter((field) => {
        const previous = before[field as keyof typeof before]
        const next = after[field as keyof typeof after]
        if (Array.isArray(previous) && Array.isArray(next)) return !sameStringSet(previous, next)
        return previous !== next
      })
      const cameBack = existing.status === 'gone' || existing.status === 'possibly_gone'

      if (changedFields.length === 0) {
        return { listingId: existing.id, outcome: 'unchanged', changedFields: [] }
      }

      const priceChanged = changedFields.includes('priceCents')
      const mileageChanged = changedFields.includes('mileage')
      const conversionChanged = changedFields.some((field) => [
        'conversionType',
        'conversionManufacturer',
        'floorLoweringInches',
        'rampType',
        'conversionStatus',
        'wavFeatures',
        'wheelchairCapacity',
      ].includes(field))
      const locationChanged = changedFields.some((field) => ['zip', 'city', 'state'].includes(field))
      const resetDetail = changedFields.some(
        (field) => !['buyerUrl', 'sellerType', 'qualityIssueCodes'].includes(field),
      )

      await tx.listing.update({
        where: { id: existing.id },
        data: {
          sourceUrl: listing.sourceUrl,
          buyerUrl,
          externalId: listing.externalId,
          stockNumber: listing.stockNumber,
          make: listing.make,
          model: listing.model,
          year: listing.year,
          trim: listing.trim,
          vin: listing.vin,
          condition: listing.condition,
          sellerType: listing.sellerType,
          priceCents: listing.priceCents,
          mileage: listing.mileage,
          color: listing.color,
          conversionType: listing.wav.conversionType,
          conversionManufacturer: listing.wav.conversionManufacturer,
          floorLoweringInches: listing.wav.floorLoweringInches,
          rampType: listing.wav.rampType,
          conversionStatus: listing.wav.conversionStatus,
          wavFeatures: listing.wav.wavFeatures,
          wheelchairCapacity: listing.wav.wheelchairCapacity,
          zip: listing.location.zip,
          city: listing.location.city,
          state: listing.location.state,
          ...(locationChanged ? { lat: null, lng: null } : {}),
          dealerName: listing.dealer.name,
          cardImages: listing.images,
          scrapedAt: new Date(),
          status: 'active',
          goneAt: null,
          publicationStatus: listing.publicationStatus ?? 'pending',
          qualityIssueCodes: listing.qualityIssueCodes ?? [],
          qualityCheckedAt: listing.qualityCheckedAt ?? null,
          ...(resetDetail ? { detailScrapedAt: null } : {}),
          ...(cameBack ? { saleStatus: 'active', soldAt: null } : {}),
        },
      })

      if (priceChanged && listing.priceCents != null) {
        await tx.listingPriceHistory.create({
        data: { listingId: existing.id, priceCents: listing.priceCents },
      })
      }

      if (mileageChanged && listing.mileage != null) {
        await tx.listingMileageHistory.create({
        data: { listingId: existing.id, mileage: listing.mileage },
      })
      }

      if (conversionChanged) {
        await tx.listingConversionHistory.create({
        data: {
          listingId: existing.id,
          conversionStatus: listing.wav.conversionStatus,
          wavFeatures: listing.wav.wavFeatures,
        },
      })
      }

      await tx.listingObservation.create({
        data: {
          listingId: existing.id,
          stage: 'list_card',
          extractionVersion: 'source-card-v1',
          changedFields,
          before,
          after,
        },
      })
      return { listingId: existing.id, outcome: 'updated', changedFields }
    }, { isolationLevel: 'Serializable' }))
  }

  async markGone(sourceId: string, activeSourceRecordKeys: string[], options: MarkGoneOptions): Promise<number> {
    // Guard: if the scrape returned nothing, assume a scraper failure and leave status unchanged
    if (activeSourceRecordKeys.length === 0) return 0

    const { isCompleteCrawl } = options

    if (!isCompleteCrawl) {
      // Partial crawl (page-1 changed but we may have missed pages): soft-mark
      // active listings as possibly_gone without counting it as evidence.
      // missingFromCompleteCount is NOT incremented — only complete crawls provide
      // conclusive index-absence evidence.
      const result = await this.db.listing.updateMany({
        where: {
          sourceId,
          status: 'active',
          sourceRecordKey: { notIn: activeSourceRecordKeys },
        },
        data: { status: 'possibly_gone', detailScrapedAt: null },
      })
      return result.count
    }

    // Complete crawl path:
    // 1. Seen listings: reset missingFromCompleteCount and record lastSeenInCompleteCrawlAt.
    //    Also restore possibly_gone → active for listings that reappeared in the source index.
    const now = new Date()
    await this.db.listing.updateMany({
      where: {
        sourceId,
        status: 'possibly_gone',
        sourceRecordKey: { in: activeSourceRecordKeys },
      },
      data: {
        missingFromCompleteCount: 0,
        lastSeenInCompleteCrawlAt: now,
        status: 'active',
        goneAt: null,
        detailScrapedAt: null,
      },
    })

    // Update lastSeenInCompleteCrawlAt for all seen non-gone listings
    await this.db.listing.updateMany({
      where: {
        sourceId,
        status: { not: 'gone' },
        sourceRecordKey: { in: activeSourceRecordKeys },
      },
      data: { lastSeenInCompleteCrawlAt: now, missingFromCompleteCount: 0 },
    })

    // 2. Count how many active listings are newly absent (before updating status).
    //    This is the "newly missing" count returned to the caller for logging.
    //    We count before the update so we have the pre-transition number.
    const newlyMissingCount = await this.db.listing.count({
      where: {
        sourceId,
        status: 'active',
        sourceRecordKey: { notIn: activeSourceRecordKeys },
      },
    })

    // 3. Increment missingFromCompleteCount for ALL absent non-gone listings
    //    (both active and already-possibly_gone) in a single UPDATE, below the
    //    threshold cap. Active listings also transition to possibly_gone here.
    //
    //    This single query prevents a double-increment that would occur if two
    //    separate UPDATEs ran: step A writing active→possibly_gone with count=1,
    //    then step B matching the now-possibly_gone rows and incrementing again
    //    to count=2 in the same run.
    await this.db.listing.updateMany({
      where: {
        sourceId,
        status: { in: ['active', 'possibly_gone'] },
        sourceRecordKey: { notIn: activeSourceRecordKeys },
        missingFromCompleteCount: { lt: GONE_AFTER_CONSECUTIVE_MISSING },
      },
      data: {
        status: 'possibly_gone',
        detailScrapedAt: null,
        missingFromCompleteCount: { increment: 1 },
      },
    })

    // 4. Promote to gone when the threshold is reached.
    await this.db.listing.updateMany({
      where: {
        sourceId,
        status: 'possibly_gone',
        sourceRecordKey: { notIn: activeSourceRecordKeys },
        missingFromCompleteCount: { gte: GONE_AFTER_CONSECUTIVE_MISSING },
      },
      data: { status: 'gone', goneAt: now },
    })

    return newlyMissingCount
  }
}
