import { describe, expect, it, vi } from 'vitest'
import { MockQueueFactory, QUEUES } from '@wivwav/queue'
import type { MockQueueAdapter } from '@wivwav/queue'
import { buildTestApp } from './admin-test-fixtures.js'

describe('GET /repeatables', () => {
  it('includes job-run reaper statistics when a reaper is configured', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp(
      {},
      {},
      factory,
      {},
      {},
      undefined,
      { getStats: () => ({ reapedCount: 2, runningTooLongCount: 3 }) } as never,
    )
    const response = await app.inject({ method: 'GET', url: '/repeatables' })
    expect(response.statusCode).toBe(200)
    expect(response.json().jobRuns).toEqual({ reapedCount: 2, runningTooLongCount: 3 })
    await app.close()
  })

  it('does not report one legacy collided schedule as enabled for both sources', async () => {
    const factory = new MockQueueFactory()
    const crawlQueue = factory.createQueue(QUEUES.DETAIL_CRAWL) as MockQueueAdapter
    crawlQueue.seedRepeatable({
      key: 'legacy-crawl',
      name: QUEUES.DETAIL_CRAWL,
      id: null,
      tz: 'America/New_York',
      pattern: '0 * * * *',
      next: Date.now() + 60_000,
      legacy: true,
    })
    const { app } = buildTestApp({
      findScheduledSources: vi.fn(async () => [
        { id: 'blvd-id', name: 'BLVD.com', cronExpression: '0 */6 * * *', timezone: 'America/New_York' },
        { id: 'mw-id', name: 'MobilityWorks', cronExpression: '0 */8 * * *', timezone: 'America/New_York' },
      ]),
    }, {}, factory)

    const res = await app.inject({ method: 'GET', url: '/repeatables' })

    expect(res.json().jobRuns).toEqual({ reapedCount: 0, runningTooLongCount: 0 })
    const schedules = res.json().data as Array<{ id: string; enabled: boolean }>
    expect(schedules.some((schedule: { id: string }) => schedule.id === 'listing-observation-cleanup')).toBe(true)
    expect(schedules.find((schedule) => schedule.id === 'blvd-crawl')?.enabled).toBe(false)
    expect(schedules.find((schedule) => schedule.id === 'mw-crawl')?.enabled).toBe(false)

    await app.close()
  })

  it('returns independent source-specific crawl and extract schedules with live state', async () => {
    const factory = new MockQueueFactory()
    const crawlQueue = factory.createQueue(QUEUES.DETAIL_CRAWL) as MockQueueAdapter
    const extractQueue = factory.createQueue(QUEUES.DETAIL_EXTRACT) as MockQueueAdapter
    await crawlQueue.addRepeatable(
      QUEUES.DETAIL_CRAWL,
      { sourceId: 'blvd-id' },
      '0 * * * *',
      'America/New_York',
      'blvd-crawl',
    )
    await crawlQueue.addRepeatable(
      QUEUES.DETAIL_CRAWL,
      { sourceId: 'mw-id' },
      '0 * * * *',
      'America/Chicago',
      'mw-crawl',
    )
    await extractQueue.addRepeatable(
      QUEUES.DETAIL_EXTRACT,
      { sourceId: 'blvd-id' },
      '*/5 * * * *',
      'America/New_York',
      'blvd-extract',
    )
    await extractQueue.addRepeatable(
      QUEUES.DETAIL_EXTRACT,
      { sourceId: 'mw-id' },
      '*/5 * * * *',
      'America/Chicago',
      'mw-extract',
    )
    await crawlQueue.add({ sourceId: 'blvd-id' })
    crawlQueue.markFailed('BLVD crawl failed')
    await crawlQueue.add({ sourceId: 'mw-id' })
    crawlQueue.markCompleted()

    const { app } = buildTestApp({
      findScheduledSources: vi.fn(async () => [
        { id: 'blvd-id', name: 'BLVD.com', cronExpression: '0 */6 * * *', timezone: 'America/New_York' },
        { id: 'mw-id', name: 'MobilityWorks', cronExpression: '0 */8 * * *', timezone: 'America/Chicago' },
      ]),
    }, {}, factory)

    const res = await app.inject({ method: 'GET', url: '/repeatables' })

    expect(res.statusCode).toBe(200)
    const schedules = res.json().data as Array<{
      id: string
      jobId: string
      label: string
      data: { sourceId: string }
      enabled: boolean
      key: string
      pattern: string
      tz: string
      next: number
      lastStatus: string | null
    }>
    expect(schedules.filter((schedule) =>
      schedule.id.endsWith('-crawl') || schedule.id.endsWith('-extract'),
    )).toEqual([
      expect.objectContaining({
        id: 'blvd-crawl',
        jobId: 'blvd-crawl',
        label: 'BLVD.com detail crawl (Playwright)',
        data: { sourceId: 'blvd-id' },
        enabled: true,
        key: 'blvd-crawl',
        pattern: '0 * * * *',
        tz: 'America/New_York',
        next: expect.any(Number),
        lastStatus: 'failed',
      }),
      expect.objectContaining({
        id: 'mw-crawl',
        jobId: 'mw-crawl',
        label: 'MobilityWorks detail crawl (Playwright)',
        data: { sourceId: 'mw-id' },
        enabled: true,
        key: 'mw-crawl',
        pattern: '0 * * * *',
        tz: 'America/Chicago',
        next: expect.any(Number),
        lastStatus: 'completed',
      }),
      expect.objectContaining({
        id: 'blvd-extract',
        jobId: 'blvd-extract',
        data: { sourceId: 'blvd-id' },
        enabled: true,
        next: expect.any(Number),
      }),
      expect.objectContaining({
        id: 'mw-extract',
        jobId: 'mw-extract',
        data: { sourceId: 'mw-id' },
        enabled: true,
        next: expect.any(Number),
      }),
    ])

    await app.close()
  })

  it('includes canonical NHTSA and VIN refresh schedules with monitoring metadata', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)

    const res = await app.inject({ method: 'GET', url: '/repeatables' })

    expect(res.statusCode).toBe(200)
    const schedules = res.json().data as Array<{
      id: string
      queue: string
      defaultPattern: string
      lastRunAt: string | null
      lastStatus: string | null
      recentFailureCount: number
      recentFailureReason: string | null
    }>

    expect(schedules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'vin-enrich',
        queue: QUEUES.VIN_ENRICH,
        defaultPattern: '0 4/6 * * *',
        lastRunAt: null,
        lastStatus: null,
        recentFailureCount: 0,
        recentFailureReason: null,
      }),
      expect.objectContaining({
        id: 'listing-sync',
        queue: QUEUES.LISTING_SYNC,
        defaultPattern: '30 1 * * *',
      }),
      expect.objectContaining({
        id: 'nhtsa-recalls',
        queue: QUEUES.NHTSA_RECALLS,
        defaultPattern: '30 4 * * *',
      }),
      expect.objectContaining({
        id: 'nhtsa-complaints',
        queue: QUEUES.NHTSA_COMPLAINTS,
        defaultPattern: '0 5 * * 0',
      }),
      expect.objectContaining({
        id: 'nhtsa-safety-ratings',
        queue: QUEUES.NHTSA_SAFETY_RATINGS,
        defaultPattern: '0 6 * * 0',
      }),
    ]))

    await app.close()
  })

  it('attributes source-scrape failures to the source that actually failed, not to every per-source schedule sharing the queue', async () => {
    const factory = new MockQueueFactory()
    const scrapeQueue = factory.createQueue(QUEUES.SOURCE_SCRAPE) as MockQueueAdapter

    await scrapeQueue.add({ sourceId: 'blvd-id' })
    scrapeQueue.markFailed('page.goto: Timeout 30000ms exceeded.')
    await scrapeQueue.add({ sourceId: 'mw-id' })

    const { app } = buildTestApp({
      findScheduledSources: vi.fn(async () => [
        { id: 'blvd-id', name: 'BLVD.com', cronExpression: '0 */6 * * *', timezone: 'America/New_York' },
        { id: 'mw-id', name: 'MobilityWorks', cronExpression: '0 */8 * * *', timezone: 'America/New_York' },
      ]),
    }, {}, factory)

    const res = await app.inject({ method: 'GET', url: '/repeatables' })
    expect(res.statusCode).toBe(200)
    const schedules = res.json().data as Array<{
      id: string
      lastStatus: string | null
      recentFailureCount: number
      recentFailureReason: string | null
    }>

    const blvd = schedules.find(s => s.id === 'blvd')
    const mw = schedules.find(s => s.id === 'mw')

    expect(blvd).toMatchObject({
      lastStatus: 'failed',
      recentFailureCount: 1,
      recentFailureReason: 'page.goto: Timeout 30000ms exceeded.',
    })
    expect(mw).toMatchObject({
      lastStatus: null,
      recentFailureCount: 0,
      recentFailureReason: null,
    })

    await app.close()
  })
})

describe('/repeatables mutations', () => {
  const blvd = { id: 'blvd-id', name: 'BLVD.com', cronExpression: '0 */6 * * *', timezone: 'America/New_York' }

  function intentWrites(db: { configEntry: { create: ReturnType<typeof vi.fn> } }) {
    return (db.configEntry.create.mock.calls as Array<[{ data: { key: string; value: Record<string, unknown> } }]>)
      .map(([arg]) => arg.data)
  }

  it.each([
    ['DELETE', { key: 'k' }],
    ['POST', { name: 'n', data: {}, pattern: '* * * * *' }],
    ['PUT', { key: 'k', name: 'n', data: {}, pattern: '* * * * *' }],
  ])('%s returns 404 for an unknown queue without side effects', async (method, payload) => {
    const { app, db } = buildTestApp({}, {}, new MockQueueFactory())
    const res = await app.inject({ method: method as 'POST', url: '/repeatables/nope', payload })
    expect(res.statusCode).toBe(404)
    expect(db.configEntry.create).not.toHaveBeenCalled()
    await app.close()
  })

  it('DELETE persists disabled intent for a canonical schedule, then removes the BullMQ key', async () => {
    const factory = new MockQueueFactory()
    const crawl = factory.createQueue(QUEUES.DETAIL_CRAWL) as MockQueueAdapter
    await crawl.addRepeatable(QUEUES.DETAIL_CRAWL, { sourceId: 'blvd-id' }, '0 * * * *', 'America/New_York', 'blvd-crawl')
    const { app, db } = buildTestApp({ findScheduledSources: vi.fn(async () => [blvd]) }, {}, factory)

    const res = await app.inject({
      method: 'DELETE',
      url: `/repeatables/${QUEUES.DETAIL_CRAWL}`,
      payload: { key: 'blvd-crawl' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { removed: true } })
    const writes = intentWrites(db)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.key).toContain('blvd-crawl')
    expect(writes[0]?.value).toMatchObject({ enabled: false })
    expect(await crawl.getRepeatableJobs()).toEqual([])
    await app.close()
  })

  it('DELETE of a non-canonical key writes no intent but still removes the BullMQ key', async () => {
    const factory = new MockQueueFactory()
    const crawl = factory.createQueue(QUEUES.DETAIL_CRAWL) as MockQueueAdapter
    await crawl.addRepeatable(QUEUES.DETAIL_CRAWL, {}, '0 * * * *', undefined, 'adhoc')
    const { app, db } = buildTestApp({}, {}, factory)

    const res = await app.inject({ method: 'DELETE', url: `/repeatables/${QUEUES.DETAIL_CRAWL}`, payload: { key: 'adhoc' } })

    expect(res.statusCode).toBe(200)
    expect(db.configEntry.create).not.toHaveBeenCalled()
    expect(await crawl.getRepeatableJobs()).toEqual([])
    await app.close()
  })

  it('POST for a canonical source-scrape schedule persists enabled intent, updates the source cron, and adds the repeatable', async () => {
    const factory = new MockQueueFactory()
    const { app, db, sources } = buildTestApp({ findScheduledSources: vi.fn(async () => [blvd]) }, {}, factory)

    const res = await app.inject({
      method: 'POST',
      url: `/repeatables/${QUEUES.SOURCE_SCRAPE}`,
      payload: { name: QUEUES.SOURCE_SCRAPE, data: { sourceId: 'blvd-id' }, pattern: '0 1 * * *', jobId: 'blvd' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ data: { added: true } })
    const writes = intentWrites(db)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.value).toMatchObject({ enabled: true, pattern: '0 1 * * *', tz: 'America/New_York' })
    expect(sources.updateCronExpression).toHaveBeenCalledWith('blvd-id', '0 1 * * *')
    const live = await (factory.createQueue(QUEUES.SOURCE_SCRAPE) as MockQueueAdapter).getRepeatableJobs()
    expect(live).toMatchObject([{ key: 'blvd', pattern: '0 1 * * *' }])
    await app.close()
  })

  it('POST for a non-source-scrape canonical schedule does not touch the source cron', async () => {
    const factory = new MockQueueFactory()
    const { app, db, sources } = buildTestApp({ findScheduledSources: vi.fn(async () => [blvd]) }, {}, factory)

    const res = await app.inject({
      method: 'POST',
      url: `/repeatables/${QUEUES.DETAIL_CRAWL}`,
      payload: { name: QUEUES.DETAIL_CRAWL, data: { sourceId: 'blvd-id' }, pattern: '30 * * * *', tz: 'America/Chicago', jobId: 'blvd-crawl' },
    })

    expect(res.statusCode).toBe(201)
    expect(intentWrites(db)[0]?.value).toMatchObject({ enabled: true, pattern: '30 * * * *', tz: 'America/Chicago' })
    expect(sources.updateCronExpression).not.toHaveBeenCalled()
    await app.close()
  })

  it('PUT replaces the BullMQ schedule and persists the new intent', async () => {
    const factory = new MockQueueFactory()
    const scrape = factory.createQueue(QUEUES.SOURCE_SCRAPE) as MockQueueAdapter
    await scrape.addRepeatable(QUEUES.SOURCE_SCRAPE, { sourceId: 'blvd-id' }, '0 */6 * * *', 'America/New_York', 'blvd')
    const { app, db, sources } = buildTestApp({ findScheduledSources: vi.fn(async () => [blvd]) }, {}, factory)

    const res = await app.inject({
      method: 'PUT',
      url: `/repeatables/${QUEUES.SOURCE_SCRAPE}`,
      payload: { key: 'blvd', name: QUEUES.SOURCE_SCRAPE, data: { sourceId: 'blvd-id' }, pattern: '0 2 * * *', jobId: 'blvd' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { updated: true } })
    expect(intentWrites(db)[0]?.value).toMatchObject({ enabled: true, pattern: '0 2 * * *' })
    expect(sources.updateCronExpression).toHaveBeenCalledWith('blvd-id', '0 2 * * *')
    expect(await scrape.getRepeatableJobs()).toMatchObject([{ key: 'blvd', pattern: '0 2 * * *' }])
    await app.close()
  })

  it('PUT for a non-canonical jobId writes no intent', async () => {
    const factory = new MockQueueFactory()
    const { app, db, sources } = buildTestApp({}, {}, factory)
    const res = await app.inject({
      method: 'PUT',
      url: `/repeatables/${QUEUES.DETAIL_CRAWL}`,
      payload: { key: 'old', name: QUEUES.DETAIL_CRAWL, data: {}, pattern: '5 * * * *', jobId: 'adhoc' },
    })
    expect(res.statusCode).toBe(200)
    expect(db.configEntry.create).not.toHaveBeenCalled()
    expect(sources.updateCronExpression).not.toHaveBeenCalled()
    await app.close()
  })
})
