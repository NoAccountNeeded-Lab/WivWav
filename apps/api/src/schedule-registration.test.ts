import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CRITICAL_JOB_OPTIONS, MockQueueAdapter, QUEUES } from '@wivwav/queue'
import {
  applyScheduleIntents,
  buildDetailScheduleDefinitions,
  reconcileSchedules,
  type ScheduleDefinition,
} from './schedule-registration.js'

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}

function detailDefinitions(
  crawl: MockQueueAdapter,
  extract: MockQueueAdapter,
): ScheduleDefinition[] {
  return buildDetailScheduleDefinitions(
    [
      { id: 'blvd-id', timezone: 'America/New_York', schedulerPrefix: 'blvd' },
      { id: 'mw-id', timezone: 'America/New_York', schedulerPrefix: 'mw' },
    ],
    { crawl, extract },
    CRITICAL_JOB_OPTIONS,
  )
}

describe('detail schedule registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds independent crawl and extract definitions for every source', () => {
    const definitions = detailDefinitions(
      new MockQueueAdapter(QUEUES.DETAIL_CRAWL),
      new MockQueueAdapter(QUEUES.DETAIL_EXTRACT),
    )

    expect(definitions.map((definition) => ({
      name: definition.name,
      sourceId: definition.data['sourceId'],
      jobId: definition.jobId,
    }))).toEqual([
      { name: QUEUES.DETAIL_CRAWL, sourceId: 'blvd-id', jobId: 'blvd-crawl' },
      { name: QUEUES.DETAIL_EXTRACT, sourceId: 'blvd-id', jobId: 'blvd-extract' },
      { name: QUEUES.DETAIL_CRAWL, sourceId: 'mw-id', jobId: 'mw-crawl' },
      { name: QUEUES.DETAIL_EXTRACT, sourceId: 'mw-id', jobId: 'mw-extract' },
    ])
  })

  it('registers both same-name same-pattern schedules when metadata ids are null', async () => {
    const crawl = new MockQueueAdapter(QUEUES.DETAIL_CRAWL)
    const extract = new MockQueueAdapter(QUEUES.DETAIL_EXTRACT)
    crawl.seedRepeatable({
      key: 'legacy-crawl',
      name: QUEUES.DETAIL_CRAWL,
      id: null,
      tz: 'America/New_York',
      pattern: '0 * * * *',
      next: null,
    })

    await reconcileSchedules(detailDefinitions(crawl, extract), logger)

    expect((await crawl.getRepeatableJobs()).map((job) => job.id).sort()).toEqual([
      'blvd-crawl',
      'mw-crawl',
    ])
    expect((await extract.getRepeatableJobs()).map((job) => job.id).sort()).toEqual([
      'blvd-extract',
      'mw-extract',
    ])
  })

  it('is idempotent on repeated startup', async () => {
    const crawl = new MockQueueAdapter(QUEUES.DETAIL_CRAWL)
    const extract = new MockQueueAdapter(QUEUES.DETAIL_EXTRACT)
    const definitions = detailDefinitions(crawl, extract)

    await reconcileSchedules(definitions, logger)
    await reconcileSchedules(definitions, logger)

    expect(await crawl.getRepeatableJobs()).toHaveLength(2)
    expect(await extract.getRepeatableJobs()).toHaveLength(2)
  })

  it('does not remove an unrelated scheduler with the same signature', async () => {
    const crawl = new MockQueueAdapter(QUEUES.DETAIL_CRAWL)
    const extract = new MockQueueAdapter(QUEUES.DETAIL_EXTRACT)
    crawl.seedRepeatable({
      key: 'custom-crawl',
      name: QUEUES.DETAIL_CRAWL,
      id: 'custom-crawl',
      tz: 'America/New_York',
      pattern: '0 * * * *',
      next: null,
      legacy: false,
    })

    await reconcileSchedules(detailDefinitions(crawl, extract), logger)

    expect((await crawl.getRepeatableJobs()).map((job) => job.id).sort()).toEqual([
      'blvd-crawl',
      'custom-crawl',
      'mw-crawl',
    ])
  })

  it('updates a scheduler in place when its jobId matches but the sourceId payload is stale (#767)', async () => {
    const crawl = new MockQueueAdapter(QUEUES.DETAIL_CRAWL)
    const extract = new MockQueueAdapter(QUEUES.DETAIL_EXTRACT)
    // Simulate a DB reseed: the scheduler for 'blvd-crawl' is already
    // registered, but its payload still references a source row id from a
    // previous DB generation.
    crawl.seedRepeatable({
      key: 'blvd-crawl',
      name: QUEUES.DETAIL_CRAWL,
      id: 'blvd-crawl',
      tz: 'America/New_York',
      pattern: '0 * * * *',
      next: null,
      legacy: false,
      data: { sourceId: 'stale-blvd-id' },
    })

    await reconcileSchedules(detailDefinitions(crawl, extract), logger)

    const jobs = await crawl.getRepeatableJobs()
    const blvdJob = jobs.find((job) => job.key === 'blvd-crawl')
    expect(blvdJob?.data).toEqual({ sourceId: 'blvd-id' })
    expect(jobs).toHaveLength(2)
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'blvd-crawl' }),
      'Schedule payload corrected to match current definition',
    )
  })

  it('leaves a scheduler untouched and logs the debug path when its payload already matches', async () => {
    const crawl = new MockQueueAdapter(QUEUES.DETAIL_CRAWL)
    const extract = new MockQueueAdapter(QUEUES.DETAIL_EXTRACT)
    const definitions = detailDefinitions(crawl, extract)

    // First pass registers the schedulers with current payloads.
    await reconcileSchedules(definitions, logger)
    vi.clearAllMocks()

    // Second pass: payload already matches, so it should be a no-op.
    await reconcileSchedules(definitions, logger)

    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'blvd-crawl' }),
      'Schedule already registered',
    )
    const jobs = await crawl.getRepeatableJobs()
    expect(jobs.find((job) => job.key === 'blvd-crawl')?.data).toEqual({ sourceId: 'blvd-id' })
  })

  it('removes a superseded scheduler matched via the legacy name+pattern fallback under a different key (#767)', async () => {
    const crawl = new MockQueueAdapter(QUEUES.DETAIL_CRAWL)
    const extract = new MockQueueAdapter(QUEUES.DETAIL_EXTRACT)
    // A single-source signature is unambiguous, so a scheduler with a
    // different key but the same name+pattern is matched via the legacy
    // fallback in findScheduledMatch, not by jobId.
    crawl.seedRepeatable({
      key: 'legacy-blvd-crawl',
      name: QUEUES.DETAIL_CRAWL,
      id: 'legacy-blvd-crawl',
      tz: 'America/New_York',
      pattern: '0 * * * *',
      next: null,
      legacy: false,
      data: { sourceId: 'stale-blvd-id' },
    })
    const definitions = buildDetailScheduleDefinitions(
      [{ id: 'blvd-id', timezone: 'America/New_York', schedulerPrefix: 'blvd' }],
      { crawl, extract },
      CRITICAL_JOB_OPTIONS,
    )

    await reconcileSchedules(definitions, logger)

    const jobs = await crawl.getRepeatableJobs()
    expect(jobs.map((job) => job.key)).toEqual(['blvd-crawl'])
    expect(jobs[0]?.data).toEqual({ sourceId: 'blvd-id' })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'legacy-blvd-crawl', replacedBy: 'blvd-crawl' }),
      'Superseded schedule removed after registering under its canonical key',
    )

    // A subsequent reconcile pass must be idempotent: no duplicate schedulers.
    vi.clearAllMocks()
    await reconcileSchedules(definitions, logger)
    expect((await crawl.getRepeatableJobs()).map((job) => job.key)).toEqual(['blvd-crawl'])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('removes a scheduler whose sourceId no longer exists in any current definition (#767)', async () => {
    const crawl = new MockQueueAdapter(QUEUES.DETAIL_CRAWL)
    const extract = new MockQueueAdapter(QUEUES.DETAIL_EXTRACT)
    // An orphaned scheduler from a source that was dropped in a later reseed:
    // its jobId no longer matches any current definition, and its sourceId
    // does not appear anywhere in the current definition set.
    crawl.seedRepeatable({
      key: 'ghost-crawl',
      name: QUEUES.DETAIL_CRAWL,
      id: 'ghost-crawl',
      tz: 'America/New_York',
      pattern: '0 * * * *',
      next: null,
      legacy: false,
      data: { sourceId: 'long-gone-id' },
    })

    await reconcileSchedules(detailDefinitions(crawl, extract), logger)

    const jobs = await crawl.getRepeatableJobs()
    expect(jobs.map((job) => job.key).sort()).toEqual(['blvd-crawl', 'mw-crawl'])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'ghost-crawl', sourceId: 'long-gone-id' }),
      'Stale schedule removed: referenced source id no longer exists',
    )
  })

  it('honors durable disabled intent by removing an existing schedule and not re-adding it', async () => {
    const crawl = new MockQueueAdapter(QUEUES.DETAIL_CRAWL)
    const extract = new MockQueueAdapter(QUEUES.DETAIL_EXTRACT)
    await reconcileSchedules(detailDefinitions(crawl, extract), logger)

    const disabledDefinitions = applyScheduleIntents(
      detailDefinitions(crawl, extract),
      new Map([['blvd-crawl', { enabled: false, updatedAt: new Date().toISOString() }]]),
    )

    await reconcileSchedules(disabledDefinitions, logger)

    expect((await crawl.getRepeatableJobs()).map((job) => job.key).sort()).toEqual(['mw-crawl'])
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'blvd-crawl' }),
      'Schedule removed to honor durable disabled intent',
    )
  })
})
