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
  /** Median age of listings with an explicit seller/source listing date. */
  medianDaysListed: number | null
  dropTotal: number
  dropCount: number
}

export type PopularStats = {
  makes: { make: string; count: number }[]
  models: { make: string; model: string; count: number }[]
  conversionBrands: { conversionManufacturer: string; count: number }[]
}

export type MarketTrendInterval = 'week' | 'month'

/** One time bucket for `GET /v1/market/trends`. */
export type MarketTrendPoint = {
  bucketStart: Date
  medianPriceCents: number | null
  activeInventoryCount: number
  /** Source-listed-to-gone duration; null when no source dates are available. */
  avgDaysToGone: number | null
}

// ── Interface ────────────────────────────────────────────────────────────────

export interface MarketRepository {
  getPricingStats(make: string, model: string, year: number | null, conversionType: string | null): Promise<PricingStats>
  getPopular(): Promise<PopularStats>
  /**
   * Time-bucketed median price, observed active inventory count, and average
   * source-listed-to-gone duration for a make/model, bucketed by `interval` between `from`
   * and `to` (inclusive). Uses a single CTE per query rather than N+1 calls
   * per bucket.
   */
  getTrends(make: string, model: string, interval: MarketTrendInterval, from: Date, to: Date): Promise<MarketTrendPoint[]>
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

type TrendRow = {
  bucketStart: Date
  medianPriceCents: number | null
  activeInventoryCount: number | bigint
  avgDaysToGone: number | null
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
          INNER JOIN sources ON sources.id = listings."sourceId"
          WHERE status = 'active'
            AND "publicationStatus" = 'eligible'
            AND sources.status != 'disabled'
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
          PERCENTILE_CONT(0.50) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM NOW() - "sourceListedAt") / 86400
          ) FILTER (WHERE "sourceListedAt" IS NOT NULL)                                                AS "medianDaysListed"
        FROM representative_listings
      `,
      this.db.$queryRaw<PriceDropRow[]>`
        WITH representative_listings AS (
          SELECT DISTINCT ON (COALESCE("vehicleId", id)) id, make, model, year, "conversionType"
          FROM listings
          INNER JOIN sources ON sources.id = listings."sourceId"
          WHERE status = 'active'
            AND "publicationStatus" = 'eligible'
            AND sources.status != 'disabled'
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
          INNER JOIN sources ON sources.id = listings."sourceId"
          WHERE status = 'active'
            AND "publicationStatus" = 'eligible'
            AND sources.status != 'disabled'
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
          INNER JOIN sources ON sources.id = listings."sourceId"
          WHERE status = 'active'
            AND "publicationStatus" = 'eligible'
            AND sources.status != 'disabled'
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
          INNER JOIN sources ON sources.id = listings."sourceId"
          WHERE status = 'active'
            AND "publicationStatus" = 'eligible'
            AND sources.status != 'disabled'
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

  async getTrends(make: string, model: string, interval: MarketTrendInterval, from: Date, to: Date): Promise<MarketTrendPoint[]> {
    // One CTE-based query computes all three metrics per bucket rather than
    // running a query per bucket (avoids N+1 as called out in #454's notes).
    // `inventory`, `price_points`, and `gone_durations` are aggregated
    // independently before being joined back onto `buckets` by bucket_start
    // so that fanning a listing out across multiple price-history rows
    // cannot skew the inventory count or the days-to-gone average.
    const rows = await this.db.$queryRaw<TrendRow[]>`
      WITH buckets AS (
        SELECT generate_series(
          date_trunc(${interval}, ${from}::timestamp),
          date_trunc(${interval}, ${to}::timestamp),
          CASE WHEN ${interval} = 'week' THEN interval '1 week' ELSE interval '1 month' END
        ) AS bucket_start
      ),
      step AS (
        SELECT CASE WHEN ${interval} = 'week' THEN interval '1 week' ELSE interval '1 month' END AS len
      ),
      representative_listings AS (
        SELECT DISTINCT ON (COALESCE("vehicleId", id))
          id, "listedAt", "sourceListedAt", "goneAt"
        FROM listings
        INNER JOIN sources ON sources.id = listings."sourceId"
        WHERE make = ${make}
          AND model = ${model}
          AND "publicationStatus" = 'eligible'
          AND sources.status != 'disabled'
        ORDER BY COALESCE("vehicleId", id), "listedAt" DESC, id ASC
      ),
      inventory AS (
        SELECT b.bucket_start, COUNT(DISTINCT r.id)::int AS active_inventory_count
        FROM buckets b
        CROSS JOIN step
        LEFT JOIN representative_listings r
          ON r."listedAt" <= (b.bucket_start + step.len)
         AND (r."goneAt" IS NULL OR r."goneAt" >= b.bucket_start)
        GROUP BY b.bucket_start
      ),
      price_points AS (
        SELECT b.bucket_start,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lph."priceCents") AS median_price_cents
        FROM buckets b
        CROSS JOIN step
        LEFT JOIN representative_listings r ON TRUE
        LEFT JOIN listing_price_history lph
          ON lph."listingId" = r.id
         AND lph."recordedAt" >= b.bucket_start
         AND lph."recordedAt" < (b.bucket_start + step.len)
        GROUP BY b.bucket_start
      ),
      gone_durations AS (
        SELECT b.bucket_start,
          AVG(EXTRACT(EPOCH FROM (r."goneAt" - r."sourceListedAt")) / 86400) AS avg_days_to_gone
        FROM buckets b
        CROSS JOIN step
        LEFT JOIN representative_listings r
          ON r."goneAt" >= b.bucket_start
         AND r."goneAt" < (b.bucket_start + step.len)
        GROUP BY b.bucket_start
      )
      SELECT
        b.bucket_start                           AS "bucketStart",
        pp.median_price_cents                     AS "medianPriceCents",
        COALESCE(inv.active_inventory_count, 0)   AS "activeInventoryCount",
        gd.avg_days_to_gone                       AS "avgDaysToGone"
      FROM buckets b
      LEFT JOIN inventory inv ON inv.bucket_start = b.bucket_start
      LEFT JOIN price_points pp ON pp.bucket_start = b.bucket_start
      LEFT JOIN gone_durations gd ON gd.bucket_start = b.bucket_start
      ORDER BY b.bucket_start ASC
    `

    return rows.map((r) => ({
      bucketStart: r.bucketStart,
      medianPriceCents: r.medianPriceCents != null ? Math.round(r.medianPriceCents) : null,
      activeInventoryCount: Number(r.activeInventoryCount),
      avgDaysToGone: r.avgDaysToGone != null ? Number(r.avgDaysToGone) : null,
    }))
  }
}
