import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CRITICAL_JOB_OPTIONS, MockQueueAdapter, QUEUES } from '@wivwav/queue'
import {
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
})
