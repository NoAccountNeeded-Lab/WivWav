import { describe, expect, it, vi } from 'vitest'
import { MockQueueFactory } from '@wivwav/queue'
import { buildTestApp } from './admin-test-fixtures.js'

// ── Quarantine ──────────────────────────────────────────────────────────────

function makeQuarantinedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    sourceId: 'src-1',
    sourceName: 'BLVD.com',
    sourceUrl: 'https://example.com/listing-1',
    sourceRecordKey: 'rec-1',
    make: 'Toyota',
    model: 'Sienna',
    year: 2022,
    qualityIssueCodes: ['contains_space'],
    qualityCheckedAt: new Date('2026-06-01T00:00:00Z'),
    scrapedAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    extractionVersion: 'source-card-v1',
    ...overrides,
  }
}

describe('GET /quarantine', () => {
  it('returns quarantined listings with rule severity attached', async () => {
    const factory = new MockQueueFactory()
    const row = makeQuarantinedRow()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findQuarantined: vi.fn(async () => [row]),
      countQuarantined: vi.fn(async () => 1),
    })

    const res = await app.inject({ method: 'GET', url: '/quarantine' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({
      id: 'listing-1',
      rules: [{ code: 'contains_space', severity: 'error' }],
      extractionVersion: 'source-card-v1',
    })
    expect(body.meta).toMatchObject({ total: 1 })
    expect(listings.findQuarantined).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 50 }))

    await app.close()
  })

  it('passes sourceId and rule filters through to the repository', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findQuarantined: vi.fn(async () => []),
      countQuarantined: vi.fn(async () => 0),
    })

    await app.inject({ method: 'GET', url: '/quarantine?sourceId=src-1&rule=contains_space&olderThanDays=7' })

    expect(listings.findQuarantined).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'src-1', rule: 'contains_space', olderThanMs: 7 * 24 * 60 * 60 * 1000 }),
    )

    await app.close()
  })

  it('resolves a severity filter to its set of rule codes', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findQuarantined: vi.fn(async () => []),
      countQuarantined: vi.fn(async () => 0),
    })

    await app.inject({ method: 'GET', url: '/quarantine?severity=error' })

    expect(listings.findQuarantined).toHaveBeenCalledWith(
      expect.objectContaining({ rule: expect.arrayContaining(['contains_space', 'active_with_sold_at']) }),
    )

    await app.close()
  })

  it('short-circuits when rule and severity filters contradict each other', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findQuarantined: vi.fn(async () => []),
      countQuarantined: vi.fn(async () => 0),
    })

    // contains_space is severity 'error'; asking for severity=warn with that rule cannot match.
    const res = await app.inject({ method: 'GET', url: '/quarantine?rule=contains_space&severity=warn' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], meta: { total: 0, skip: 0, take: 0 } })
    expect(listings.findQuarantined).not.toHaveBeenCalled()

    await app.close()
  })

  it('caps take at the maximum page size', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findQuarantined: vi.fn(async () => []),
      countQuarantined: vi.fn(async () => 0),
    })

    await app.inject({ method: 'GET', url: '/quarantine?take=10000' })

    expect(listings.findQuarantined).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }))

    await app.close()
  })
})

describe('POST /quarantine/:id/reprocess', () => {
  it('reprocesses a quarantined listing', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory, {
      reprocessQuarantined: vi.fn(async () => true),
    })

    const res = await app.inject({ method: 'POST', url: '/quarantine/listing-1/reprocess' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { reprocessed: true } })
    expect(listings.reprocessQuarantined).toHaveBeenCalledWith('listing-1')

    await app.close()
  })

  it('returns 404 when the listing is not quarantined', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory, {
      reprocessQuarantined: vi.fn(async () => false),
    })

    const res = await app.inject({ method: 'POST', url: '/quarantine/missing/reprocess' })

    expect(res.statusCode).toBe(404)

    await app.close()
  })
})

function makeFieldConflictRow(overrides: Record<string, unknown> = {}) {
  return {
    listingId: 'listing-1',
    sourceUrl: 'https://dealer.example.com/listing/1',
    make: 'Toyota',
    model: 'Sienna',
    year: 2022,
    field: 'conversionType',
    competingValues: ['side_entry', 'rear_entry'],
    evidenceKinds: ['structured_source', 'vehicle_text'],
    sourceRefs: ['https://dealer.example.com/listing/1', 'https://dealer.example.com/listing/1/detail'],
    manuallyHiddenAt: null,
    observedAts: [new Date('2026-01-01'), new Date('2026-01-02')],
    detectedAt: new Date('2026-01-02'),
    ...overrides,
  }
}

describe('GET /field-conflicts', () => {
  it('returns unresolved field conflicts with competing claims', async () => {
    const factory = new MockQueueFactory()
    const row = makeFieldConflictRow()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findFieldConflicts: vi.fn(async () => [row]),
      countFieldConflicts: vi.fn(async () => 1),
    })

    const res = await app.inject({ method: 'GET', url: '/field-conflicts' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({
      listingId: 'listing-1',
      field: 'conversionType',
      competingValues: ['side_entry', 'rear_entry'],
      evidenceKinds: ['structured_source', 'vehicle_text'],
    })
    expect(body.meta).toMatchObject({ total: 1 })
    expect(listings.findFieldConflicts).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 50 }))

    await app.close()
  })

  it('passes sourceId and field filters through to the repository', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findFieldConflicts: vi.fn(async () => []),
      countFieldConflicts: vi.fn(async () => 0),
    })

    await app.inject({ method: 'GET', url: '/field-conflicts?sourceId=src-1&field=rampType' })

    expect(listings.findFieldConflicts).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'src-1', field: 'rampType' }),
    )
    expect(listings.countFieldConflicts).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'src-1', field: 'rampType' }),
    )

    await app.close()
  })

  it('caps take at the maximum page size', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findFieldConflicts: vi.fn(async () => []),
      countFieldConflicts: vi.fn(async () => 0),
    })

    await app.inject({ method: 'GET', url: '/field-conflicts?take=10000' })

    expect(listings.findFieldConflicts).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }))

    await app.close()
  })
})

describe('GET /listing-reports', () => {
  it('returns unresolved listing report triage rows with pagination metadata', async () => {
    const factory = new MockQueueFactory()
    const rows = [{
      listingId: 'listing-1',
      sourceUrl: 'https://example.com/listing-1',
      make: 'Toyota',
      model: 'Sienna',
      year: 2022,
      unresolvedCount: 4,
      latestReportedAt: new Date('2026-07-14T08:00:00Z'),
      reportTypes: ['specs_incorrect', 'sold_or_stale'],
    }]
    const { app, listings } = buildTestApp({}, {}, factory, {
      findListingReportTriage: vi.fn(async () => rows),
      countListingReportTriage: vi.fn(async () => 1),
    })

    const res = await app.inject({ method: 'GET', url: '/listing-reports?minReports=3&skip=5&take=10' })

    expect(res.statusCode).toBe(200)
    expect(listings.findListingReportTriage).toHaveBeenCalledWith({ minReports: 3, skip: 5, take: 10 })
    expect(listings.countListingReportTriage).toHaveBeenCalledWith({ minReports: 3 })
    expect(res.json()).toEqual({
      data: [{
        ...rows[0],
        latestReportedAt: '2026-07-14T08:00:00.000Z',
      }],
      meta: { total: 1, skip: 5, take: 10 },
    })

    await app.close()
  })

  it('caps take and defaults minReports to one', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory)

    await app.inject({ method: 'GET', url: '/listing-reports?take=10000&minReports=0' })

    expect(listings.findListingReportTriage).toHaveBeenCalledWith({ minReports: 1, skip: 0, take: 200 })

    await app.close()
  })
})

describe('GET /images/:imageId/semantic-analyses', () => {
  it('returns full semantic image analysis attempts including low-confidence and failures', async () => {
    const factory = new MockQueueFactory()
    const rows = [
      {
        id: 'attempt-1',
        listingImageId: 'image-1',
        contentHash: 'sha256-ok',
        semanticAnalysisVersion: 1,
        provider: 'provider',
        model: 'model',
        schemaVersion: '1',
        status: 'success',
        errorCode: null,
        errorMessage: null,
        labels: [{ label: 'ramp', confidence: 0.4 }],
        fieldClaims: [{ field: 'rampType', claimedValue: 'fold_out', confidence: 0.4 }],
        altText: null,
        summary: 'low confidence ramp candidate',
        observedAt: new Date('2026-07-20T01:00:00Z'),
        createdAt: new Date('2026-07-20T01:00:00Z'),
        listingImage: {
          id: 'image-1',
          listingId: 'listing-1',
          originalUrl: 'https://dealer.example.com/ramp.jpg',
          normalizedUrl: 'https://dealer.example.com/ramp.jpg',
          position: 0,
        },
      },
      {
        id: 'attempt-2',
        listingImageId: 'image-1',
        contentHash: 'sha256-failed',
        semanticAnalysisVersion: 1,
        provider: 'provider',
        model: 'model',
        schemaVersion: '1',
        status: 'error',
        errorCode: 'provider_error',
        errorMessage: 'timeout',
        labels: [],
        fieldClaims: [],
        altText: null,
        summary: null,
        observedAt: new Date('2026-07-20T02:00:00Z'),
        createdAt: new Date('2026-07-20T02:00:00Z'),
        listingImage: {
          id: 'image-1',
          listingId: 'listing-1',
          originalUrl: 'https://dealer.example.com/ramp.jpg',
          normalizedUrl: 'https://dealer.example.com/ramp.jpg',
          position: 0,
        },
      },
    ]
    const { app, listings } = buildTestApp({}, {}, factory, {
      findSemanticAnalysesForImage: vi.fn(async () => rows),
    })

    const res = await app.inject({ method: 'GET', url: '/images/image-1/semantic-analyses' })

    expect(res.statusCode).toBe(200)
    expect(listings.findSemanticAnalysesForImage).toHaveBeenCalledWith('image-1')
    expect(res.json()).toMatchObject({
      data: [
        { id: 'attempt-1', status: 'success', fieldClaims: [{ confidence: 0.4 }] },
        { id: 'attempt-2', status: 'error', errorCode: 'provider_error', errorMessage: 'timeout' },
      ],
    })

    await app.close()
  })
})
