/**
 * Fixture-to-facets pipeline contract suite (#640).
 *
 * Exercises the full production chain — parsed observation → database row →
 * publication decision → search document → facet API → filtered listing API
 * — against real, disposable PostgreSQL and Meilisearch instances, using a
 * small checked-in catalog (fixture-to-facets.catalog.ts) backed by the
 * offline source fixtures added for #639
 * (apps/scraper/src/sources/fixtures/contracts/).
 *
 * Unlike the mocked unit tests it complements (apps/api's facet/listings
 * tests mock Meilisearch distributions; apps/scraper's job tests mock
 * persistence/search boundaries; meilisearch-sync.test.ts mocks both), every
 * checkpoint here is real production code, invoked synchronously (no BullMQ
 * timing):
 *   - card persistence:      ingestListing (apps/scraper/src/application/listing-ingest.ts)
 *   - detail-update path:    buildListingDetailUpdateData + a transaction shaped
 *                            exactly like detail-extract.ts's own tx.listing.update
 *   - deduplication:         runDeduplicateJob (apps/scraper/src/jobs/deduplicate.ts)
 *   - publication resolution: runListingResolveJob (apps/scraper/src/jobs/listing-resolve.ts)
 *   - full search sync:      runMeilisearchSyncJob (apps/scraper/src/jobs/meilisearch-sync.ts)
 *   - facets/listings API:   apps/api's real ListingFacetsService / ListingSearchService /
 *                            MeilisearchService, called directly (see the cross-app import
 *                            note below for why this stops short of the actual Fastify route).
 *
 * Cross-app import note: this file imports apps/api SERVICE modules (not the
 * Fastify route handlers) by relative path — no apps/scraper -> apps/api
 * package dependency is declared. This is a deliberate, narrow exception:
 * the suite's entire purpose is proving the scraper-ingestion and API-facet
 * halves of the pipeline agree on real data, and neither app can express
 * that contract from inside its own package. It stops at the service layer
 * (ListingFacetsService.getFacets / ListingSearchService.search) rather than
 * spinning up the real `GET /v1/listings/facets` Fastify route: the route
 * layer only does querystring parsing and TypeBox response validation
 * (covered by apps/api/src/routes/listings.test.ts) and pulling it in here
 * would require this app to also carry apps/api's Fastify/TypeBox
 * dependency graph as devDependencies purely to satisfy Vite's module
 * resolution for files this suite never actually needs to validate.
 *
 * Local run:   pnpm --filter @wivwav/scraper exec vitest run src/pipeline/fixture-to-facets.integration.test.ts
 *              (needs a reachable Postgres + Meilisearch — `docker compose up -d postgres meilisearch`,
 *              then `pnpm db:migrate`)
 * CI runtime target: under 60s (one Chromium launch, ~11 catalog rows, one
 * full Meilisearch rebuild, one incremental sync).
 *
 * CI wiring: this file — along with schedule-registration.integration.test.ts,
 * the only other apps/scraper integration spec that doesn't hit a live
 * third-party website — runs via the root `pnpm test:integration` script
 * (turbo task `test:integration:offline`, apps/scraper/package.json's
 * `test:integration:offline` script). apps/scraper's plain `test:integration`
 * script also runs the live-network source-adapter specs (blvd.integration.test.ts
 * and friends) and is intentionally excluded from CI; only run it locally.
 *
 * Every assertion failure below names the checkpoint it covers so a
 * regression is traceable to the layer that diverged, per the AC.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Meilisearch } from 'meilisearch'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb, disconnectDb } from '@wivwav/db'
import type { PrismaClient } from '@wivwav/db'
import { INDEX_NAME } from '@wivwav/search'
import { PlaywrightBrowserService } from '../browser/index.js'
import type { BrowserPage, BrowserSession } from '../browser/index.js'
import { evaluateBlvdCards, parseCard as parseBlvdCard } from '../sources/blvd.js'
import { evaluateBlvdDetail, parseBlvdDetail } from '../sources/blvd-detail.js'
import { evaluateMobilityWorksCards, parseCard as parseMwCard } from '../sources/mobilityworks.js'
import { evaluateMwDetail, parseMwDetail } from '../sources/mobilityworks-detail.js'
import { ingestListing } from '../application/listing-ingest.js'
import {
  buildListingDetailUpdateData,
  changedDetailFields,
  blvdEvidence,
  type DetailResult,
} from '../jobs/detail-extract.js'
import { runDeduplicateJob } from '../jobs/deduplicate.js'
import { runListingResolveJob } from '../jobs/listing-resolve.js'
import { runMeilisearchSyncJob } from '../jobs/meilisearch-sync.js'
import {
  buildHandAuthoredRows,
  EXPECTED_TOTAL,
  EXPECTED_BREAKDOWNS,
  EXPECTED_WAV_FEATURE_COUNTS,
  EXPECTED_PRICE_BUCKETS,
  EXPECTED_MILEAGE_BUCKETS,
  EXPECTED_FILTER_COUNTS,
  type CatalogRow,
  type ListingUpsertData,
} from './fixture-to-facets.catalog.js'

// apps/api SERVICE modules — see the cross-app import note above. Neither
// module imports Fastify, TypeBox, or any other apps/api-only dependency.
import {
  ListingSearchService,
  type SearchParams,
} from '../../../api/src/services/listing-search.js'
import {
  ListingFacetsService,
  type FacetsParams,
} from '../../../api/src/services/listing-facets.js'
import { MeilisearchService } from '../../../api/src/services/search/meilisearch-service.js'
import { MemoryCacheService } from '../../../api/src/services/cache/memory-cache-service.js'

// Real Meilisearch instances are shared by app + api env var conventions
// (apps/scraper reads MEILI_HOST/MEILI_API_KEY, apps/api reads
// MEILISEARCH_HOST/MEILISEARCH_API_KEY) — normalize both to the same
// real, disposable instance so runMeilisearchSyncJob (scraper) and the
// facets/listings API (api) operate on the exact same index.
process.env['MEILISEARCH_HOST'] ??= 'http://localhost:7700'
process.env['MEILISEARCH_API_KEY'] ??= 'wav_master_key'
process.env['MEILI_HOST'] ??= process.env['MEILISEARCH_HOST']
process.env['MEILI_API_KEY'] ??= process.env['MEILISEARCH_API_KEY']

// Fixtures relocated with the source parsers to packages/scraper-sources (#950).
const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
  'packages',
  'scraper-sources',
  'src',
  'sources',
  'fixtures',
  'contracts',
)

function fixtureHtml(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8')
}

async function openFixture(session: BrowserSession, name: string): Promise<BrowserPage> {
  const page = await session.newPage({ failOnExternalRequests: true })
  await page.setContent(fixtureHtml(name), { waitUntil: 'load' })
  return page
}

describe('fixture-to-facets pipeline contract (#640)', () => {
  const db: PrismaClient = getDb()
  const meili = new Meilisearch({
    host: process.env['MEILISEARCH_HOST']!,
    ...(process.env['MEILISEARCH_API_KEY'] ? { apiKey: process.env['MEILISEARCH_API_KEY'] } : {}),
  })

  let blvdSourceId: string
  let mwSourceId: string
  let pendingSourceId: string
  let rows: CatalogRow[]
  let services: ReturnType<typeof buildServices>
  const cache = new MemoryCacheService()

  async function resetDb(): Promise<void> {
    await db.$executeRawUnsafe(`
      TRUNCATE TABLE
        "listing_observation",
        "listing_price_history",
        "listing_mileage_history",
        "listing_conversion_history",
        "listings",
        "vehicle",
        "sources"
      RESTART IDENTITY CASCADE
    `)
  }

  async function clearIndex(): Promise<void> {
    const task = await meili
      .index(INDEX_NAME)
      .deleteAllDocuments()
      .catch(() => null)
    if (task) await meili.tasks.waitForTask(task.taskUid, { timeout: 15_000 })
  }

  /**
   * Builds the two DOM-fixture-derived catalog rows by driving the real,
   * checked-in offline HTML fixtures through the real card + detail parsers
   * — the same production functions fixture-contract.test.ts (#639) exercises
   * for pure DOM-extraction. Here their output feeds the *next* stage:
   * ingestListing (card persistence) and buildListingDetailUpdateData +
   * a tx.listing.update shaped exactly like detail-extract.ts's own update
   * (detail-update persistence).
   */
  async function buildFixtureDerivedRows(session: BrowserSession): Promise<{
    blvd: { card: ListingUpsertData; detail: DetailResult }
    mw: { card: ListingUpsertData; detail: DetailResult }
  }> {
    const blvdListPage = await openFixture(session, 'blvd-list-v1.html')
    const blvdDetailPage = await openFixture(session, 'blvd-detail-v1.html')
    const mwListPage = await openFixture(session, 'mobilityworks-list-v1.html')
    const mwDetailPage = await openFixture(session, 'mobilityworks-detail-v1.html')

    try {
      const blvdCards = await evaluateBlvdCards(blvdListPage)
      const blvdRawCard = blvdCards[0]
      if (!blvdRawCard) throw new Error('[fixture-to-facets] Missing BLVD normal card (index 0)')
      const blvdCard = parseBlvdCard(blvdRawCard)
      if (!blvdCard) throw new Error('[fixture-to-facets] BLVD normal card did not parse')

      const blvdRawDetail = await evaluateBlvdDetail(blvdDetailPage)
      const blvdDetailFields = parseBlvdDetail(blvdRawDetail)
      const blvdDetail: DetailResult = {
        ...blvdDetailFields,
        evidence: blvdEvidence(blvdRawDetail),
      }

      const mwCards = await evaluateMobilityWorksCards(mwListPage)
      const mwRawCard = mwCards[0]
      if (!mwRawCard)
        throw new Error('[fixture-to-facets] Missing MobilityWorks normal card (index 0)')
      const mwCard = parseMwCard(mwRawCard)
      if (!mwCard) throw new Error('[fixture-to-facets] MobilityWorks normal card did not parse')

      const mwRawDetail = await evaluateMwDetail(mwDetailPage)
      const mwDetailFields = parseMwDetail(mwRawDetail)
      const mwDetail: DetailResult = {
        ...mwDetailFields,
        // MobilityWorks exposes an explicit "Fuel Type" spec key; no engine
        // description field — mirrors detail-extract.ts's own MW branch.
        engine: null,
        evidence: {
          color:
            Object.hasOwn(mwRawDetail.specs, 'Exterior Color') ||
            Object.hasOwn(mwRawDetail.specs, 'Color')
              ? 'value'
              : 'missing',
          fuelType: Object.hasOwn(mwRawDetail.specs, 'Fuel Type') ? 'value' : 'missing',
          engine: 'missing',
          transmission: Object.hasOwn(mwRawDetail.specs, 'Transmission') ? 'value' : 'missing',
          description: mwRawDetail.descriptionFound
            ? mwRawDetail.descriptionText.trim().length > 0
              ? 'value'
              : 'authoritative_empty'
            : 'missing',
          images: mwRawDetail.galleryFound
            ? mwRawDetail.imageUrls.length > 0
              ? 'value'
              : 'authoritative_empty'
            : 'missing',
        },
      }

      return {
        blvd: {
          card: {
            ...blvdCard,
            sourceId: blvdSourceId,
            sourceRecordKey: 'CATALOG-BLVD-1',
            // BLVD list cards do not expose detail-owned accessibility fields —
            // matches the real production shape the detail-update path fills in.
            color: null,
            wav: { ...blvdCard.wav, rampType: 'unknown', wavFeatures: [] },
          } as ListingUpsertData,
          detail: blvdDetail,
        },
        mw: {
          card: {
            ...mwCard,
            sourceId: mwSourceId,
            sourceRecordKey: 'CATALOG-MW-1',
          } as ListingUpsertData,
          detail: mwDetail,
        },
      }
    } finally {
      await blvdListPage.close()
      await blvdDetailPage.close()
      await mwListPage.close()
      await mwDetailPage.close()
    }
  }

  /**
   * Applies a DetailResult to a persisted listing exactly the way
   * detail-extract.ts's runDetailExtractJob does (buildListingDetailUpdateData
   * + changedDetailFields + a tx.listing.update carrying the same fields) —
   * without re-driving that job's browser-launch/rawPage/network-enrichment
   * plumbing, which fixture-contract.test.ts and detail-extract.test.ts
   * already cover directly.
   */
  async function applyDetailUpdate(listingId: string, detail: DetailResult): Promise<void> {
    const existing = await db.listing.findUniqueOrThrow({ where: { id: listingId } })
    const now = new Date()
    const update = buildListingDetailUpdateData(
      detail,
      { dealerWebsite: null, directVehicleUrl: null },
      {},
      now,
    )
    const changed = changedDetailFields(
      existing as unknown as Record<string, unknown>,
      update as Record<string, unknown>,
    )
    const before = Object.fromEntries(
      changed.map((field) => [
        field,
        (existing as unknown as Record<string, unknown>)[field] ?? null,
      ]),
    )
    const after = Object.fromEntries(
      changed.map((field) => [field, (update as Record<string, unknown>)[field] ?? null]),
    )
    // Same statements detail-extract.ts's runDetailExtractJob wraps in a
    // Serializable db.$transaction — reproduced here without the wrapper
    // since this suite is single-writer (no concurrent detail extraction
    // racing this same listing), so the isolation guarantee has nothing to
    // protect against in this context.
    await db.listing.update({ where: { id: existing.id }, data: update })
    await db.listingObservation.create({
      data: {
        listingId: existing.id,
        stage: 'detail',
        reference: `fixture-to-facets:${listingId}:${now.toISOString()}`,
        extractionVersion: 'detail-v2-evidence',
        changedFields: changed,
        before,
        after,
        observedAt: now,
      },
    })
  }

  async function ingestRow(row: CatalogRow): Promise<string> {
    const result = await db.$transaction((tx) => ingestListing(tx, row.upsert))
    return result.listingId
  }

  function buildServices() {
    const searchService = new MeilisearchService(meili)
    return {
      search: new ListingSearchService(searchService),
      facets: new ListingFacetsService(searchService, cache),
    }
  }

  beforeAll(async () => {
    await resetDb()
    await clearIndex()

    const blvdSource = await db.source.create({
      data: { name: 'Fixture-to-facets BLVD', baseUrl: 'https://fixture.example.com/blvd' },
    })
    const mwSource = await db.source.create({
      data: { name: 'Fixture-to-facets MobilityWorks', baseUrl: 'https://fixture.example.com/mw' },
    })
    const pendingSource = await db.source.create({
      data: {
        name: 'Fixture-to-facets Pending Queue',
        baseUrl: 'https://fixture.example.com/pending',
      },
    })
    blvdSourceId = blvdSource.id
    mwSourceId = mwSource.id
    pendingSourceId = pendingSource.id

    const session = await new PlaywrightBrowserService().launch()
    let derived: Awaited<ReturnType<typeof buildFixtureDerivedRows>>
    try {
      derived = await buildFixtureDerivedRows(session)
    } finally {
      await session.close()
    }

    rows = [
      { id: 'blvd-fixture', lifecycle: 'eligible', upsert: derived.blvd.card },
      { id: 'mobilityworks-fixture', lifecycle: 'eligible', upsert: derived.mw.card },
      ...buildHandAuthoredRows({ blvdSourceId, mwSourceId, pendingSourceId }),
    ]

    const listingIdByRow = new Map<string, string>()
    for (const row of rows) {
      listingIdByRow.set(row.id, await ingestRow(row))
    }

    // Detail-update production path — applied only to the two DOM-fixture
    // rows (their cards deliberately omit detail-owned fields above); every
    // hand-authored row already carries its full accessibility data at
    // ingest time since it exists purely for facet-value diversity, not to
    // re-prove the card/detail split (already proven here for BLVD).
    await applyDetailUpdate(listingIdByRow.get('blvd-fixture')!, derived.blvd.detail)
    await applyDetailUpdate(listingIdByRow.get('mobilityworks-fixture')!, derived.mw.detail)

    // Deduplication (production code) — links the duplicate-a/duplicate-b VIN pair.
    await runDeduplicateJob()

    // Publication resolution (production code), synchronously, per source —
    // pendingSourceId is deliberately never drained.
    await runListingResolveJob({ sourceId: blvdSourceId })
    await runListingResolveJob({ sourceId: mwSourceId })

    // gone-after-eligible: transition to 'gone' after resolution, mirroring
    // what detail-extract.ts's resolveListingStatus would produce for a
    // sold/removed listing.
    const goneId = listingIdByRow.get('gone-after-eligible')!
    await db.listing.update({ where: { id: goneId }, data: { status: 'gone', goneAt: new Date() } })

    // Full Meilisearch sync (production code) — versioned rebuild + atomic swap.
    await runMeilisearchSyncJob()

    services = buildServices()
  }, 60_000)

  afterAll(async () => {
    await resetDb()
    await clearIndex()
    await disconnectDb()
  })

  /** Mirrors GET /v1/listings/facets — see the cross-app import note above for why this calls the service directly. */
  async function getFacets(params: FacetsParams = {}): Promise<Record<string, unknown>> {
    return services.facets.getFacets(params) as unknown as Record<string, unknown>
  }

  /** Mirrors GET /v1/listings — see the cross-app import note above for why this calls the service directly. */
  async function getListingsTotal(params: SearchParams): Promise<number> {
    const result = await services.search.search(params)
    return result.total
  }

  function toRecord(breakdown: Array<{ value: string; count: number }>): Record<string, number> {
    return Object.fromEntries(breakdown.map((b) => [b.value, b.count]))
  }

  function toBucketRecord(
    breakdown: Array<{ bucket: string; count: number }>,
  ): Record<string, number> {
    return Object.fromEntries(breakdown.map((b) => [b.bucket, b.count]))
  }

  /** ListingFacetsService field name -> FacetsResult breakdown key (not all follow `${field}Breakdown`). */
  const BREAKDOWN_KEY: Record<string, string> = {
    make: 'makeBreakdown',
    model: 'modelBreakdown',
    trim: 'trimBreakdown',
    year: 'yearDistribution',
    condition: 'conditionBreakdown',
    sellerType: 'sellerTypeBreakdown',
    state: 'stateBreakdown',
    color: 'colorBreakdown',
    conversionType: 'conversionBreakdown',
    rampType: 'rampTypeBreakdown',
    conversionBrand: 'conversionBrandBreakdown',
  }

  it('[database row checkpoint] every catalog row lands in Postgres via the production repository path', async () => {
    const count = await db.listing.count()
    expect(
      count,
      '[database row] expected every catalog row (including excluded lifecycles) to be persisted',
    ).toBe(rows.length)
  })

  it('[publication decision checkpoint] pending, quarantined, and gone listings never reach publicationStatus: eligible', async () => {
    const pending = await db.listing.findFirst({ where: { sourceId: pendingSourceId } })
    expect(
      pending?.publicationStatus,
      '[publication decision] pending-never-resolved must stay pending',
    ).toBe('pending')

    const quarantined = await db.listing.findFirst({ where: { sourceRecordKey: 'CATALOG-BLVD-4' } })
    expect(
      quarantined?.publicationStatus,
      '[publication decision] quarantined-bad-year must be quarantined',
    ).toBe('quarantined')
    expect(quarantined?.qualityIssueCodes).toContain('implausible_year')

    const gone = await db.listing.findFirst({ where: { sourceRecordKey: 'CATALOG-MW-3' } })
    expect(gone?.status, '[publication decision] gone-after-eligible must have status: gone').toBe(
      'gone',
    )
  })

  it('[search document checkpoint] a duplicate vehicle group contributes exactly one representative', async () => {
    const dupRows = await db.listing.findMany({ where: { vin: '1FTFW1XT0EFA12345' } })
    expect(
      dupRows,
      '[search document] both duplicate rows should share one vehicleId after runDeduplicateJob',
    ).toHaveLength(2)
    expect(dupRows[0]!.vehicleId).not.toBeNull()
    expect(dupRows[0]!.vehicleId).toBe(dupRows[1]!.vehicleId)

    const doc = await meili
      .index(INDEX_NAME)
      .getDocument(dupRows.find((r) => r.sourceRecordKey === 'CATALOG-MW-2')!.id)
    expect(
      doc['color'],
      '[search document] the more-complete duplicate member must be the synced representative',
    ).toBe('Silver')

    const otherId = dupRows.find((r) => r.sourceRecordKey === 'CATALOG-BLVD-3')!.id
    await expect(meili.index(INDEX_NAME).getDocument(otherId)).rejects.toThrow()
  })

  it('[facet API checkpoint] GET /v1/listings/facets total equals eligible unique vehicle groups, not raw listing rows', async () => {
    const facets = await getFacets()
    expect(
      facets['total'],
      '[facet API] total must count vehicle groups (7), not the 11 persisted rows',
    ).toBe(EXPECTED_TOTAL)
  })

  it.each(Object.entries(EXPECTED_BREAKDOWNS))(
    '[facet API checkpoint] %s breakdown matches the hand-authored manifest exactly',
    async (field, expected) => {
      const facets = await getFacets()
      const key = BREAKDOWN_KEY[field]!
      if (field === 'year') {
        const actual = Object.fromEntries(
          (facets[key] as Array<{ year: number; count: number }>).map((b) => [b.year, b.count]),
        )
        expect(actual, `[facet API] ${key} diverged from the hand-authored manifest`).toEqual(
          expected,
        )
        return
      }
      const actual = toRecord(facets[key] as Array<{ value: string; count: number }>)
      expect(actual, `[facet API] ${key} diverged from the hand-authored manifest`).toEqual(
        expected,
      )
    },
  )

  it('[facet API checkpoint] wavFeatureCounts are multi-valued and are not asserted to sum to total', async () => {
    const facets = await getFacets()
    const wavFeatureCounts = facets['wavFeatureCounts'] as Record<string, number>
    expect(
      wavFeatureCounts,
      '[facet API] wavFeatureCounts diverged from the hand-authored manifest',
    ).toEqual(EXPECTED_WAV_FEATURE_COUNTS)

    const sum = Object.values(wavFeatureCounts).reduce((a, b) => a + b, 0)
    expect(
      sum,
      '[facet API] multi-valued wavFeature counts legitimately exceed total — this is not a bug',
    ).toBeGreaterThan(EXPECTED_TOTAL)
    expect(wavFeatureCounts['has_lift']).toBeUndefined()
  })

  it('[facet API checkpoint] priceDistribution and mileageDistribution buckets match, including exact boundaries', async () => {
    const facets = await getFacets()
    expect(
      toBucketRecord(facets['priceDistribution'] as Array<{ bucket: string; count: number }>),
    ).toEqual(EXPECTED_PRICE_BUCKETS)
    expect(
      toBucketRecord(facets['mileageDistribution'] as Array<{ bucket: string; count: number }>),
    ).toEqual(EXPECTED_MILEAGE_BUCKETS)
  })

  it.each(EXPECTED_FILTER_COUNTS)(
    '[filtered listing API checkpoint] $param=$value returns total=$total',
    async ({ param, value, total }) => {
      const actual = await getListingsTotal({ [param]: [value] } as SearchParams)
      expect(
        actual,
        `[filtered listing API] ${param}=${value} diverged from the hand-authored manifest`,
      ).toBe(total)
    },
  )

  it('[filtered listing API checkpoint] combined-filter case narrows to the intersection', async () => {
    // make=Ford AND state=TX isolates exactly the duplicate group's representative.
    expect(await getListingsTotal({ make: ['Ford'], state: ['TX'] })).toBe(1)
    // make=Toyota AND condition=used isolates the two DOM-fixture rows, excluding extra-diversity (new).
    expect(await getListingsTotal({ make: ['Toyota'], condition: ['used'] })).toBe(2)
  })

  it('[filtered listing API checkpoint] range-filter cases isolate exact bucket boundaries', async () => {
    // priceMin/priceMax straddling only the $50,000 boundary row.
    expect(await getListingsTotal({ priceMin: 4_900_000, priceMax: 5_100_000 })).toBe(1)
    // yearMin/yearMax spanning the two 2023 rows only.
    expect(await getListingsTotal({ yearMin: 2023, yearMax: 2023 })).toBe(2)
    // mileageMax=24000 isolates the 0-12000 and 12000-24000 buckets (2 rows)
    // plus the exact 24,000-mile boundary row (bucket-boundaries) — 3 total.
    expect(await getListingsTotal({ mileageMax: 24_000 })).toBe(3)
  })

  it('[facet API checkpoint] disjunctive-faceting requests used by the web client are covered', async () => {
    // apps/web's CategoryBarChart fetches facets once per active param with
    // that one param omitted (buildFacetsUrl), so an active make filter must
    // not suppress other makes from the state/color/etc. breakdowns when the
    // web client queries with make omitted — and vice versa.
    const withMakeFilter = await getFacets({ make: ['Ford'] })
    expect(
      toRecord(withMakeFilter['stateBreakdown'] as Array<{ value: string; count: number }>),
    ).toEqual({ TX: 1 })

    const stateBreakdownOmittingMake = await getFacets({}) // web client's disjunctive call for the 'make' param
    expect(
      toRecord(
        stateBreakdownOmittingMake['makeBreakdown'] as Array<{ value: string; count: number }>,
      ),
      '[facet API] the disjunctive (make-omitted) call must show every make, not just the currently-filtered one',
    ).toEqual(EXPECTED_BREAKDOWNS.make)
  })

  // NOTE: apps/scraper/src/sources/fixtures/contracts/blvd-list-v2-recrawl.html
  // (and its recorded values in expected.json's "recrawl" block) is
  // deliberately NOT reused here. fixture-contract.test.ts (#639) already
  // proves that fixture parses to the same price/mileage this phase applies
  // below; this suite's job is the *next* stage — persistence and
  // preservation semantics — so the recrawled values are applied directly as
  // a ListingUpsertData rather than re-driving DOM parsing a second time.
  describe('recrawl phase', () => {
    it('[database row checkpoint] a card-only recrawl updates price/mileage while preserving detail-owned fields', async () => {
      const before = await db.listing.findFirstOrThrow({
        where: { sourceRecordKey: 'CATALOG-BLVD-1' },
      })
      expect(before.color).not.toBeNull()
      expect(before.rampType).toBe('fold_out')
      expect(before.wavFeatures.length).toBeGreaterThan(0)

      // A recrawled BLVD card exposes no color/ramp/wavFeatures — same shape
      // ingestListing sees on every real BLVD card recrawl.
      const baseline = rows.find((r) => r.id === 'blvd-fixture')!.upsert
      const recrawlCard: ListingUpsertData = {
        ...baseline,
        priceCents: 6_950_000,
        mileage: 50_211,
        color: null,
        wav: { ...baseline.wav, rampType: 'unknown', wavFeatures: [] },
      }
      await db.$transaction((tx) => ingestListing(tx, recrawlCard))

      const after = await db.listing.findFirstOrThrow({
        where: { sourceRecordKey: 'CATALOG-BLVD-1' },
      })
      expect(after.priceCents, '[database row] recrawl must update price').toBe(6_950_000)
      expect(after.mileage, '[database row] recrawl must update mileage').toBe(50_211)
      expect(
        after.color,
        '[database row] detail-owned color must survive a card-only recrawl',
      ).toBe(before.color)
      expect(
        after.rampType,
        '[database row] detail-owned rampType must survive a card-only recrawl',
      ).toBe(before.rampType)
      expect(
        after.wavFeatures,
        '[database row] detail-owned wavFeatures must survive a card-only recrawl',
      ).toEqual(before.wavFeatures)

      // Card recrawl invalidates the prior publication decision (resetDetail) —
      // production code re-resolves it before the search sync can trust it again.
      expect(after.publicationStatus).toBe('pending')
      await runListingResolveJob({ sourceId: blvdSourceId })
    })

    it('[search document checkpoint] cache behavior: a stale facets response is served until invalidated, then reflects the resync', async () => {
      const before = await getFacets({ make: ['Toyota'] })
      const beforePrice = toBucketRecord(
        before['priceDistribution'] as Array<{ bucket: string; count: number }>,
      )
      expect(
        beforePrice['70000-75000'],
        'precondition: blvd-fixture must still be in the pre-recrawl $70-75k bucket',
      ).toBe(1)

      await runMeilisearchSyncJob()

      const stillCached = await getFacets({ make: ['Toyota'] })
      expect(
        toBucketRecord(
          stillCached['priceDistribution'] as Array<{ bucket: string; count: number }>,
        ),
        '[cache behavior] the facets cache must still serve the pre-resync distribution until invalidated',
      ).toEqual(beforePrice)

      cache.clear()

      const fresh = await getFacets({ make: ['Toyota'] })
      const freshPrice = toBucketRecord(
        fresh['priceDistribution'] as Array<{ bucket: string; count: number }>,
      )
      expect(
        freshPrice['70000-75000'],
        '[cache behavior] after invalidation, facets must reflect the recrawled price',
      ).toBeUndefined()
      // mobilityworks-fixture ($68,250) already lives in this bucket — the
      // recrawled blvd-fixture ($69,500) now joins it, making 2.
      expect(
        freshPrice['65000-70000'],
        '[cache behavior] recrawled blvd-fixture now falls in the $65-70k bucket',
      ).toBe(2)
    })

    it('[search document checkpoint] deletion/exclusion: a listing that goes missing is removed from search and facets on reindex', async () => {
      const extraDiversity = await db.listing.findFirstOrThrow({
        where: { sourceRecordKey: 'CATALOG-BLVD-6' },
      })
      await db.listing.update({
        where: { id: extraDiversity.id },
        data: { status: 'gone', goneAt: new Date() },
      })

      await runMeilisearchSyncJob()
      cache.clear()

      await expect(meili.index(INDEX_NAME).getDocument(extraDiversity.id)).rejects.toThrow()

      const facets = await getFacets()
      expect(
        facets['total'],
        '[facet API] total must drop by 1 once extra-diversity goes gone and is reindexed',
      ).toBe(EXPECTED_TOTAL - 1)
      const makeBreakdown = toRecord(
        facets['makeBreakdown'] as Array<{ value: string; count: number }>,
      )
      expect(makeBreakdown['Toyota'], '[facet API] Toyota count must drop from 3 to 2').toBe(2)
    })
  })
})
