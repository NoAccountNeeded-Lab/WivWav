import type { PrismaClient } from '@wivwav/db'
import type { FieldMapping } from '@wivwav/types'
import type {
  ScraperRunRepository,
  ScraperRunRecord,
  SourceRepository,
  ListingRepository,
  ListingUpsertData,
} from '../engine/repositories.js'

const TRANSIENT_PRISMA_CODES = new Set(['P2028', 'P1001', 'P1002', 'P1008', 'P1017'])
const TRANSIENT_DB_MESSAGES = ['connection closed', 'connection reset', 'transaction already closed']

/**
 * Returns true for Prisma errors that represent transient connection or transaction
 * failures that are safe to retry: P2028 (transaction already closed), and connection
 * errors P1001/P1002/P1008/P1017.
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

export class PrismaScraperRunRepository implements ScraperRunRepository {
  constructor(private readonly db: PrismaClient) {}

  async start(sourceId: string): Promise<ScraperRunRecord> {
    return this.db.scraperRun.create({ data: { sourceId, startedAt: new Date() } })
  }

  async complete(id: string, listingsFound: number): Promise<void> {
    await this.db.scraperRun.update({
      where: { id },
      data: { finishedAt: new Date(), success: true, listingsFound },
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

  async markActive(id: string, data: { listingCount: number; fingerprintHash: string; page1Hash?: string }): Promise<void> {
    await this.db.source.update({
      where: { id },
      data: {
        lastScrapedAt: new Date(),
        listingCount: data.listingCount,
        fingerprintHash: data.fingerprintHash,
        ...(data.page1Hash !== undefined ? { page1Hash: data.page1Hash } : {}),
        status: 'active',
        errorMessage: null,
      },
    })
  }

  async markChecked(id: string): Promise<void> {
    await this.db.source.update({ where: { id }, data: { lastCheckedAt: new Date() } })
    // Reset error status when a no-change check succeeds — the source is reachable
    await this.db.source.updateMany({ where: { id, status: 'error' }, data: { status: 'active', errorMessage: null } })
  }

  async markError(id: string, errorMessage: string): Promise<void> {
    await this.db.source.update({
      where: { id },
      data: { status: 'error', errorMessage },
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
}

export class PrismaListingRepository implements ListingRepository {
  constructor(private readonly db: PrismaClient) {}

  async upsert(listing: ListingUpsertData): Promise<void> {
    const existing = await this.db.listing.findUnique({
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
        sellerType: true,
        priceCents: true,
        mileage: true,
        conversionStatus: true,
        wavFeatures: true,
        status: true,
      },
    })

    const priceChanged =
      existing !== null &&
      listing.priceCents !== undefined &&
      listing.priceCents !== existing.priceCents

    const mileageChanged =
      existing !== null &&
      listing.mileage !== existing.mileage

    const conversionChanged =
      existing !== null &&
      (listing.wav.conversionStatus !== existing.conversionStatus ||
        !sameStringSet(listing.wav.wavFeatures, existing.wavFeatures))

    const cameBack =
      existing !== null &&
      (existing.status === 'gone' || existing.status === 'possibly_gone')

    const buyerUrl =
      existing?.buyerUrl && existing.buyerUrl !== existing.sourceUrl && listing.buyerUrl === listing.sourceUrl
        ? existing.buyerUrl
        : listing.buyerUrl

    const metadataChanged =
      existing !== null &&
      (existing.buyerUrl !== buyerUrl || existing.sellerType !== listing.sellerType || existing.sourceUrl !== listing.sourceUrl)

    if (existing !== null && !priceChanged && !mileageChanged && !conversionChanged && !cameBack && !metadataChanged) {
      return
    }

    // Reset detailScrapedAt to re-queue the detail crawl when price changes or
    // a previously-gone listing reappears, so we get fresh detail page data.
    const resetDetail = priceChanged || cameBack

    // Wrap the upsert (which uses nested writes = implicit Prisma interactive transaction)
    // in a transient-error retry. Under concurrent worker load the pg.Pool can return a
    // connection mid-transaction or the implicit transaction can close before Prisma commits,
    // both surfacing as P2028 "Transaction already closed". Retrying up to 3 times with
    // exponential backoff eliminates transient failures without masking real data errors.
    await withTransientRetry(() => this.db.listing.upsert({
      where: {
        sourceId_sourceRecordKey: {
          sourceId: listing.sourceId,
          sourceRecordKey: listing.sourceRecordKey,
        },
      },
      update: {
        priceCents: listing.priceCents,
        mileage: listing.mileage,
        sourceUrl: listing.sourceUrl,
        buyerUrl,
        sellerType: listing.sellerType,
        scrapedAt: new Date(),
        status: 'active',
        goneAt: null,
        // Any changed source observation invalidates the previous quality
        // decision. A validator must explicitly promote the row again.
        publicationStatus: 'pending',
        qualityIssueCodes: listing.qualityIssueCodes ?? [],
        qualityCheckedAt: null,
        ...(resetDetail ? { detailScrapedAt: null } : {}),
        ...(cameBack ? { saleStatus: 'active', soldAt: null } : {}),
        // description and images are managed by the detail scrape job — don't overwrite
      },
      create: {
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
        images: listing.images,
        description: listing.description,
        qualityIssueCodes: listing.qualityIssueCodes ?? [],
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
      },
    }))

    if (priceChanged && listing.priceCents != null) {
      await this.db.listingPriceHistory.create({
        data: { listingId: existing!.id, priceCents: listing.priceCents },
      })
    }

    if (mileageChanged && listing.mileage != null) {
      await this.db.listingMileageHistory.create({
        data: { listingId: existing!.id, mileage: listing.mileage },
      })
    }

    if (conversionChanged) {
      await this.db.listingConversionHistory.create({
        data: {
          listingId: existing!.id,
          conversionStatus: listing.wav.conversionStatus,
          wavFeatures: listing.wav.wavFeatures,
        },
      })
    }
  }

  async markGone(sourceId: string, activeSourceRecordKeys: string[]): Promise<number> {
    // Guard: if the scrape returned nothing, assume a scraper failure and leave status unchanged
    if (activeSourceRecordKeys.length === 0) return 0

    // Soft-mark as possibly_gone rather than confirmed gone. The detail-crawl
    // job will re-crawl the detail page (detailScrapedAt reset) to confirm.
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
}
