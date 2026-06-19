import type { PrismaClient } from '@wivwav/db'

// ── Shape types ──────────────────────────────────────────────────────────────

export type PricingStats = {
  count: number
  p10: number | null
  p25: number | null
  p50: number | null
  p75: number | null
  p90: number | null
  medianMileage: number | null
  medianDaysListed: number | null
  dropTotal: number
  dropCount: number
}

export type PopularStats = {
  makes: { make: string; count: number }[]
  models: { make: string; model: string; count: number }[]
  conversionBrands: { conversionManufacturer: string; count: number }[]
}

// ── Interface ────────────────────────────────────────────────────────────────

export interface MarketRepository {
  getPricingStats(make: string, model: string, year: number | null, conversionType: string | null): Promise<PricingStats>
  getPopular(): Promise<PopularStats>
}

// ── Raw SQL row shapes (internal) ────────────────────────────────────────────

type PricingRow = {
  count: number | bigint
  p10: number | null
  p25: number | null
  p50: number | null
  p75: number | null
  p90: number | null
  medianMileage: number | null
  medianDaysListed: number | null
}

type PriceDropRow = {
  total: number | bigint
  dropped: number | bigint
}

// ── Prisma implementation ────────────────────────────────────────────────────

export class PrismaMarketRepository implements MarketRepository {
  constructor(private readonly db: PrismaClient) {}

  async getPricingStats(make: string, model: string, year: number | null, conversionType: string | null): Promise<PricingStats> {
    const [pricingRows, dropRows] = await Promise.all([
      this.db.$queryRaw<PricingRow[]>`
        SELECT
          COUNT(*)::int                                                                                    AS count,
          PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY "priceCents")                                     AS p10,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY "priceCents")                                     AS p25,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY "priceCents")                                     AS p50,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "priceCents")                                     AS p75,
          PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY "priceCents")                                     AS p90,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY mileage)                                          AS "medianMileage",
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM NOW() - "listedAt") / 86400)   AS "medianDaysListed"
        FROM listings
        WHERE status = 'active'
          AND "isDuplicate" = false
          AND "priceCents" IS NOT NULL
          AND make = ${make}
          AND model = ${model}
          AND (${year}::int IS NULL OR year BETWEEN ${year}::int - 2 AND ${year}::int + 2)
          AND (${conversionType}::text IS NULL OR "conversionType"::text = ${conversionType}::text)
      `,
      this.db.$queryRaw<PriceDropRow[]>`
        SELECT
          COUNT(DISTINCT l.id)::int                                                                       AS total,
          COUNT(DISTINCT CASE WHEN fp."priceCents" > lp."priceCents" THEN l.id END)::int                 AS dropped
        FROM listings l
        INNER JOIN (
          SELECT DISTINCT ON ("listingId") "listingId", "priceCents"
          FROM listing_price_history
          ORDER BY "listingId", "recordedAt" ASC
        ) fp ON fp."listingId" = l.id
        INNER JOIN (
          SELECT DISTINCT ON ("listingId") "listingId", "priceCents"
          FROM listing_price_history
          ORDER BY "listingId", "recordedAt" DESC
        ) lp ON lp."listingId" = l.id
        WHERE l.status = 'active'
          AND l."isDuplicate" = false
          AND l.make = ${make}
          AND l.model = ${model}
          AND (${year}::int IS NULL OR l.year BETWEEN ${year}::int - 2 AND ${year}::int + 2)
          AND (${conversionType}::text IS NULL OR l."conversionType"::text = ${conversionType}::text)
      `,
    ])

    const pricing = pricingRows[0]
    const drop = dropRows[0]

    return {
      count: Number(pricing?.count ?? 0),
      p10: pricing?.p10 ?? null,
      p25: pricing?.p25 ?? null,
      p50: pricing?.p50 ?? null,
      p75: pricing?.p75 ?? null,
      p90: pricing?.p90 ?? null,
      medianMileage: pricing?.medianMileage ?? null,
      medianDaysListed: pricing?.medianDaysListed ?? null,
      dropTotal: Number(drop?.total ?? 0),
      dropCount: Number(drop?.dropped ?? 0),
    }
  }

  async getPopular(): Promise<PopularStats> {
    const [makes, models, brands] = await Promise.all([
      this.db.listing.groupBy({
        by: ['make'],
        where: { status: 'active', isDuplicate: false },
        _count: { make: true },
        orderBy: { _count: { make: 'desc' } },
        take: 10,
      }),
      this.db.listing.groupBy({
        by: ['make', 'model'],
        where: { status: 'active', isDuplicate: false },
        _count: { make: true },
        orderBy: { _count: { make: 'desc' } },
        take: 10,
      }),
      this.db.listing.groupBy({
        by: ['conversionManufacturer'],
        where: { status: 'active', isDuplicate: false, conversionManufacturer: { not: null } },
        _count: { conversionManufacturer: true },
        orderBy: { _count: { conversionManufacturer: 'desc' } },
        take: 10,
      }),
    ])

    return {
      makes: makes.map((r) => ({ make: r.make, count: r._count.make })),
      models: models.map((r) => ({ make: r.make, model: r.model, count: r._count.make })),
      conversionBrands: brands
        .filter((r) => r.conversionManufacturer !== null)
        .map((r) => ({ conversionManufacturer: r.conversionManufacturer as string, count: r._count.conversionManufacturer })),
    }
  }
}
