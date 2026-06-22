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

type PopularRow = {
  make?: string
  model?: string
  conversionManufacturer?: string | null
  count: number | bigint
}

// ── Prisma implementation ────────────────────────────────────────────────────

export class PrismaMarketRepository implements MarketRepository {
  constructor(private readonly db: PrismaClient) {}

  async getPricingStats(make: string, model: string, year: number | null, conversionType: string | null): Promise<PricingStats> {
    const [pricingRows, dropRows] = await Promise.all([
      this.db.$queryRaw<PricingRow[]>`
        WITH representative_listings AS (
          SELECT DISTINCT ON (COALESCE("vehicleId", id)) *
          FROM listings
          WHERE status = 'active'
            AND "priceCents" IS NOT NULL
            AND make = ${make}
            AND model = ${model}
            AND (${year}::int IS NULL OR year BETWEEN ${year}::int - 2 AND ${year}::int + 2)
            AND (${conversionType}::text IS NULL OR "conversionType"::text = ${conversionType}::text)
          ORDER BY COALESCE("vehicleId", id), "listedAt" DESC, id ASC
        )
        SELECT
          COUNT(*)::int                                                                                    AS count,
          PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY "priceCents")                                     AS p10,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY "priceCents")                                     AS p25,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY "priceCents")                                     AS p50,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "priceCents")                                     AS p75,
          PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY "priceCents")                                     AS p90,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY mileage)                                          AS "medianMileage",
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM NOW() - "listedAt") / 86400)   AS "medianDaysListed"
        FROM representative_listings
      `,
      this.db.$queryRaw<PriceDropRow[]>`
        WITH representative_listings AS (
          SELECT DISTINCT ON (COALESCE("vehicleId", id)) id, make, model, year, "conversionType"
          FROM listings
          WHERE status = 'active'
            AND make = ${make}
            AND model = ${model}
            AND (${year}::int IS NULL OR year BETWEEN ${year}::int - 2 AND ${year}::int + 2)
            AND (${conversionType}::text IS NULL OR "conversionType"::text = ${conversionType}::text)
          ORDER BY COALESCE("vehicleId", id), "listedAt" DESC, id ASC
        )
        SELECT
          COUNT(DISTINCT l.id)::int                                                                       AS total,
          COUNT(DISTINCT CASE WHEN fp."priceCents" > lp."priceCents" THEN l.id END)::int                 AS dropped
        FROM representative_listings l
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
      this.db.$queryRaw<PopularRow[]>`
        WITH representative_listings AS (
          SELECT DISTINCT ON (COALESCE("vehicleId", id)) make
          FROM listings
          WHERE status = 'active'
          ORDER BY COALESCE("vehicleId", id), "listedAt" DESC, id ASC
        )
        SELECT make, COUNT(*)::int AS count
        FROM representative_listings
        GROUP BY make
        ORDER BY count DESC, make ASC
        LIMIT 10
      `,
      this.db.$queryRaw<PopularRow[]>`
        WITH representative_listings AS (
          SELECT DISTINCT ON (COALESCE("vehicleId", id)) make, model
          FROM listings
          WHERE status = 'active'
          ORDER BY COALESCE("vehicleId", id), "listedAt" DESC, id ASC
        )
        SELECT make, model, COUNT(*)::int AS count
        FROM representative_listings
        GROUP BY make, model
        ORDER BY count DESC, make ASC, model ASC
        LIMIT 10
      `,
      this.db.$queryRaw<PopularRow[]>`
        WITH representative_listings AS (
          SELECT DISTINCT ON (COALESCE("vehicleId", id)) "conversionManufacturer"
          FROM listings
          WHERE status = 'active'
          ORDER BY COALESCE("vehicleId", id), "listedAt" DESC, id ASC
        )
        SELECT "conversionManufacturer", COUNT(*)::int AS count
        FROM representative_listings
        WHERE "conversionManufacturer" IS NOT NULL
        GROUP BY "conversionManufacturer"
        ORDER BY count DESC, "conversionManufacturer" ASC
        LIMIT 10
      `,
    ])

    return {
      makes: makes.map((r) => ({ make: r.make ?? '', count: Number(r.count) })),
      models: models.map((r) => ({ make: r.make ?? '', model: r.model ?? '', count: Number(r.count) })),
      conversionBrands: brands
        .filter((r) => r.conversionManufacturer !== null)
        .map((r) => ({ conversionManufacturer: r.conversionManufacturer as string, count: Number(r.count) })),
    }
  }
}
