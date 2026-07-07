import type { Prisma } from '@wivwav/db'
import { PrismaClient } from '@wivwav/db'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { apiBaseUrl, databaseUrl, e2eEnv } from './compose.js'

export const fixtureListingId = 'e2e-smoke-listing-1'

const sourceId = 'e2e-smoke-source'
const sourceRecordKey = 'e2e-smoke-listing-1'
const listedAt = new Date('2026-01-15T12:00:00.000Z')

export async function seedSmokeFixture(): Promise<void> {
  process.env['DATABASE_URL'] = databaseUrl()

  const pool = new Pool({ connectionString: databaseUrl(), max: 1 })
  const adapter = new PrismaPg(pool)
  const db = new PrismaClient({ adapter })

  const listingData = {
    id: fixtureListingId,
    sourceId,
    sourceUrl: 'https://example.com/e2e-smoke-listing-1',
    buyerUrl: 'https://example.com/e2e-smoke-listing-1?ref=wivwav',
    externalId: 'e2e-smoke-listing-1',
    stockNumber: 'E2E-001',
    sourceRecordKey,
    make: 'Toyota',
    model: 'Sienna',
    year: 2024,
    trim: 'XLE',
    vin: '5TDYRKEC0RS000001',
    condition: 'used',
    sellerType: 'dealer',
    priceCents: 5299000,
    mileage: 14200,
    color: 'Silver',
    fuelType: 'Hybrid',
    engine: null,
    transmission: 'Automatic',
    conversionType: 'side_entry',
    conversionManufacturer: 'VMI',
    floorLoweringInches: 2.5,
    rampType: 'fold_out',
    conversionStatus: 'complete',
    wavFeatures: ['power_ramp', 'tie_down_system'],
    wheelchairCapacity: 1,
    zip: '75201',
    city: 'Dallas',
    state: 'TX',
    lat: 32.7767,
    lng: -96.797,
    vehicleId: null,
    vehicleModelId: null,
    vehicleModelMatchConfidence: null,
    dealerName: 'E2E Mobility',
    dealerPhone: '214-555-0100',
    dealerWebsite: 'https://example.com',
    dealerProfileId: null,
    cardImages: [],
    images: [],
    description: 'A deterministic smoke-test wheelchair accessible vehicle listing.',
    isDuplicate: false,
    canonicalId: null,
    status: 'active',
    saleStatus: 'active',
    goneAt: null,
    soldAt: null,
    publicationStatus: 'eligible',
    qualityIssueCodes: [],
    qualityCheckedAt: listedAt,
    missingFromCompleteCount: 0,
    lastSeenInCompleteCrawlAt: listedAt,
    listedAt,
    scrapedAt: listedAt,
    detailScrapedAt: listedAt,
    processingLockedAt: null,
  } satisfies Prisma.ListingUncheckedCreateInput

  try {
    await db.source.upsert({
      where: { id: sourceId },
      create: {
        id: sourceId,
        name: 'E2E Smoke Source',
        baseUrl: 'https://example.com',
        status: 'active',
        cronExpression: '0 0 1 1 *',
        timezone: 'America/Denver',
      },
      update: {
        name: 'E2E Smoke Source',
        baseUrl: 'https://example.com',
        status: 'active',
        cronExpression: '0 0 1 1 *',
        timezone: 'America/Denver',
      },
    })

    await db.listing.upsert({
      where: { id: fixtureListingId },
      create: listingData,
      update: listingData,
    })
  } finally {
    await db.$disconnect()
    await pool.end()
  }
}

export async function syncSearchIndex(): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/admin/sync`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${e2eEnv.internalApiSecret}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Admin search sync failed: ${response.status} ${await response.text()}`)
  }
}

export async function waitForFixtureInSearch(): Promise<void> {
  await poll(async () => {
    const response = await fetch(`${apiBaseUrl()}/v1/listings?q=Sienna`)
    if (!response.ok) return false
    const body = (await response.json()) as { data?: Array<{ id?: string }> }
    return body.data?.some((listing) => listing.id === fixtureListingId) ?? false
  }, 'fixture listing to appear in search')
}

export async function poll(predicate: () => Promise<boolean>, label: string): Promise<void> {
  const timeoutMs = 30_000
  const intervalMs = 1_000
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Timed out waiting for ${label}`)
}
