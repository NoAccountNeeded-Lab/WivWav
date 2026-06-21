import type { PrismaClient } from '@wivwav/db'

export interface NmeaDealerRow {
  id: string
  name: string
  city: string | null
  state: string | null
  phone: string | null
  website: string | null
  qapCertified: boolean
  /** Distance in miles from the query point, or null when no coordinates available. */
  distanceMiles: number | null
}

export interface NmeaDealerRepository {
  findNearby(lat: number, lng: number, radiusMiles: number, limit: number): Promise<NmeaDealerRow[]>
}

/**
 * Haversine distance in miles using PostgreSQL math functions.
 * Dealers without coordinates are excluded from results.
 */
export class PrismaNmeaDealerRepository implements NmeaDealerRepository {
  constructor(private readonly db: PrismaClient) {}

  async findNearby(lat: number, lng: number, radiusMiles: number, limit: number): Promise<NmeaDealerRow[]> {
    // Haversine formula: d = 2R * asin(sqrt(sin²(Δlat/2) + cos(lat1)*cos(lat2)*sin²(Δlng/2)))
    // R = 3958.8 miles
    const rows = await this.db.$queryRaw<Array<{
      id: string
      name: string
      city: string | null
      state: string | null
      phone: string | null
      website: string | null
      qapCertified: boolean
      distanceMiles: number
    }>>`
      SELECT
        id,
        name,
        city,
        state,
        phone,
        website,
        "qapCertified",
        (
          3958.8 * 2 * asin(
            sqrt(
              power(sin(radians(lat - ${lat}) / 2), 2) +
              cos(radians(${lat})) * cos(radians(lat)) *
              power(sin(radians(lng - ${lng}) / 2), 2)
            )
          )
        ) AS "distanceMiles"
      FROM nmea_dealers
      WHERE lat IS NOT NULL AND lng IS NOT NULL
        AND (
          3958.8 * 2 * asin(
            sqrt(
              power(sin(radians(lat - ${lat}) / 2), 2) +
              cos(radians(${lat})) * cos(radians(lat)) *
              power(sin(radians(lng - ${lng}) / 2), 2)
            )
          )
        ) <= ${radiusMiles}
      ORDER BY "distanceMiles" ASC
      LIMIT ${limit}
    `

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      city: r.city,
      state: r.state,
      phone: r.phone,
      website: r.website,
      qapCertified: r.qapCertified,
      distanceMiles: r.distanceMiles != null ? Math.round(Number(r.distanceMiles) * 10) / 10 : null,
    }))
  }
}
