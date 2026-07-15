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

/**
 * Enqueues the scraper's full versioned search re-index job and returns its
 * BullMQ job id, so callers can poll the job's own status (waiting/active/
 * completed/failed) rather than blind-polling the search API — see
 * `waitForSyncJobToComplete` (#740).
 */
export async function syncSearchIndex(): Promise<string> {
  const response = await fetch(`${apiBaseUrl()}/admin/sync`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${e2eEnv.internalApiSecret}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Admin search sync failed: ${response.status} ${await response.text()}`)
  }

  const body = (await response.json()) as { data?: { jobId?: string } }
  const jobId = body.data?.jobId
  if (!jobId) {
    throw new Error('Admin search sync response did not include a jobId')
  }
  return jobId
}

// listing-sync is the queue name the scraper's full re-index job runs on
// (packages/queue/src/queues.ts QUEUES.LISTING_SYNC). Duplicated here as a
// literal rather than pulling in @wivwav/queue as an e2e dependency.
const LISTING_SYNC_QUEUE_NAME = 'listing-sync'

interface AdminQueueJob {
  id: string
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
  failedReason?: string
}

/**
 * Polls the listing-sync queue's own job status for `jobId` instead of
 * blind-polling the search API, so global setup can distinguish "still
 * running" from "failed" from "done" (#740) — a job that is genuinely stuck
 * or has failed produces an immediate, specific error rather than a generic
 * timeout once every retry is exhausted.
 */
export async function waitForSyncJobToComplete(jobId: string, timeoutMs = 90_000): Promise<void> {
  const intervalMs = 1_000
  const startedAt = Date.now()
  let lastKnownStatus: AdminQueueJob['status'] | 'unknown' = 'unknown'

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${apiBaseUrl()}/admin/queues/${LISTING_SYNC_QUEUE_NAME}`, {
      headers: {
        authorization: `Bearer ${e2eEnv.internalApiSecret}`,
      },
    }).catch(() => null)

    if (response?.ok) {
      const body = (await response.json()) as { data?: { jobs?: AdminQueueJob[] } }
      const job = body.data?.jobs?.find((candidate) => candidate.id === jobId)

      if (job) {
        lastKnownStatus = job.status
        if (job.status === 'completed') return
        if (job.status === 'failed') {
          throw new Error(
            `Listing-sync job "${jobId}" failed: ${job.failedReason ?? 'no failure reason reported'}`,
          )
        }
        // waiting / active / delayed: the job is progressing normally, keep polling.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for listing-sync job "${jobId}" to complete `
    + `(last known status: ${lastKnownStatus})`,
  )
}

export async function waitForFixtureInSearch(): Promise<void> {
  await poll(async () => {
    const response = await fetch(`${apiBaseUrl()}/v1/listings?q=Sienna`, {
      headers: { authorization: `Bearer ${e2eEnv.internalApiSecret}` },
    })
    if (!response.ok) return false
    const body = (await response.json()) as { data?: Array<{ id?: string }> }
    return body.data?.some((listing) => listing.id === fixtureListingId) ?? false
  }, 'fixture listing to appear in search after listing-sync job completed')
}

export async function poll(
  predicate: () => Promise<boolean>,
  label: string,
  timeoutMs = 30_000,
): Promise<void> {
  const intervalMs = 1_000
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Timed out waiting for ${label}`)
}
