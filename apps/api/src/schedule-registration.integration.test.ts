import { afterAll, describe, expect, it } from 'vitest'
import { BullMQQueueFactory, CRITICAL_JOB_OPTIONS } from '@wivwav/queue'
import type { QueueAdapter } from '@wivwav/queue'
import {
  buildDetailScheduleDefinitions,
  reconcileSchedules,
  type ScheduleDefinition,
} from './schedule-registration.js'

// Regression coverage for #631: two SCHEDULE_DEFS entries that share the same
// `name` + `pattern` (detail-crawl/detail-extract intentionally use one
// pattern per queue across all sources) must both register as independent
// BullMQ Job Scheduler entries, keyed by their distinct jobId, rather than
// the second definition being skipped as an "already scheduled" collision
// with the first. The mock adapter (schedule-registration.test.ts) exercises
// the same scenario against an in-memory fake; this test drives the real
// BullMQQueueAdapter against a live Redis/Valkey instance so a regression in
// how BullMQ 5's Job Scheduler API reports repeatable-job identity would
// actually be caught.
//
// Requires a reachable Redis/Valkey (QUEUE_REDIS_URL / VALKEY_URL, default
// redis://localhost:6379 — `docker compose up -d valkey` starts one).
// Excluded from `pnpm test` by this package's test script; run explicitly via
// `pnpm --filter @wivwav/api test:integration`.
const noopLogger = { debug: () => {}, info: () => {}, warn: () => {} }

describe('reconcileSchedules against real BullMQ/Redis (integration)', () => {
  const suffix = `it-${Date.now()}`
  const factory = new BullMQQueueFactory()
  const crawl: QueueAdapter = factory.createQueue(`detail-crawl-${suffix}`)
  const extract: QueueAdapter = factory.createQueue(`detail-extract-${suffix}`)

  afterAll(async () => {
    for (const job of await crawl.getRepeatableJobs()) {
      await crawl.removeRepeatableByKey(job.key)
    }
    for (const job of await extract.getRepeatableJobs()) {
      await extract.removeRepeatableByKey(job.key)
    }
    await factory.close()
  })

  it('registers independent BLVD and MobilityWorks schedules despite a shared name+pattern', async () => {
    const definitions = buildDetailScheduleDefinitions(
      [
        { id: 'blvd-id', timezone: 'America/New_York', schedulerPrefix: 'blvd' },
        { id: 'mw-id', timezone: 'America/New_York', schedulerPrefix: 'mw' },
      ],
      { crawl, extract },
      CRITICAL_JOB_OPTIONS,
    )

    await reconcileSchedules(definitions, noopLogger)

    expect((await crawl.getRepeatableJobs()).map((job) => job.id).sort()).toEqual([
      'blvd-crawl',
      'mw-crawl',
    ])
    expect((await extract.getRepeatableJobs()).map((job) => job.id).sort()).toEqual([
      'blvd-extract',
      'mw-extract',
    ])

    // A second reconciliation against the same Redis instance (simulating a
    // scraper restart) must be idempotent — no duplicate or dropped schedules.
    await reconcileSchedules(definitions, noopLogger)
    expect(await crawl.getRepeatableJobs()).toHaveLength(2)
    expect(await extract.getRepeatableJobs()).toHaveLength(2)
  }, 20_000)
})

// Regression coverage for #767: a DB reseed recreates `sources` rows with new
// cuids while Valkey survives untouched. Schedulers are keyed by a stable
// jobId (derived from the source's schedulerKey, not the row id), so
// reconciliation must detect the sourceId payload drift and self-heal on the
// next scraper startup instead of leaving every scheduler pointed at dead
// row ids forever.
describe('reconcileSchedules self-heals a DB reseed against real BullMQ/Redis (integration)', () => {
  const suffix = `it-reseed-${Date.now()}`
  const factory = new BullMQQueueFactory()
  const scrape: QueueAdapter = factory.createQueue(`source-scrape-${suffix}`)
  const crawl: QueueAdapter = factory.createQueue(`detail-crawl-${suffix}`)
  const extract: QueueAdapter = factory.createQueue(`detail-extract-${suffix}`)

  afterAll(async () => {
    for (const queue of [scrape, crawl, extract]) {
      for (const job of await queue.getRepeatableJobs()) {
        await queue.removeRepeatableByKey(job.key)
      }
    }
    await factory.close()
  })

  function definitionsFor(sourceId: string): ScheduleDefinition[] {
    return [
      {
        queue: scrape,
        name: 'source-scrape',
        data: { sourceId },
        pattern: '0 * * * *',
        tz: 'America/New_York',
        jobId: 'blvd',
        options: CRITICAL_JOB_OPTIONS,
      },
      ...buildDetailScheduleDefinitions(
        [{ id: sourceId, timezone: 'America/New_York', schedulerPrefix: 'blvd' }],
        { crawl, extract },
        CRITICAL_JOB_OPTIONS,
      ),
    ]
  }

  it('converges scheduler payloads to new source ids after source rows are dropped and recreated', async () => {
    await reconcileSchedules(definitionsFor('gen1-blvd-id'), noopLogger)

    let scrapeJobs = await scrape.getRepeatableJobs()
    let crawlJobs = await crawl.getRepeatableJobs()
    let extractJobs = await extract.getRepeatableJobs()
    expect(scrapeJobs.find((j) => j.key === 'blvd')?.data).toEqual({ sourceId: 'gen1-blvd-id' })
    expect(crawlJobs.find((j) => j.key === 'blvd-crawl')?.data).toEqual({ sourceId: 'gen1-blvd-id' })
    expect(extractJobs.find((j) => j.key === 'blvd-extract')?.data).toEqual({ sourceId: 'gen1-blvd-id' })

    // Simulate a Postgres-only reseed: source rows are dropped and recreated
    // with new cuids, but the BullMQ schedulers (in Valkey) are untouched —
    // jobIds stay the same, only the underlying source id changes.
    await reconcileSchedules(definitionsFor('gen2-blvd-id'), noopLogger)

    scrapeJobs = await scrape.getRepeatableJobs()
    crawlJobs = await crawl.getRepeatableJobs()
    extractJobs = await extract.getRepeatableJobs()

    expect(scrapeJobs).toHaveLength(1)
    expect(crawlJobs).toHaveLength(1)
    expect(extractJobs).toHaveLength(1)
    expect(scrapeJobs.find((j) => j.key === 'blvd')?.data).toEqual({ sourceId: 'gen2-blvd-id' })
    expect(crawlJobs.find((j) => j.key === 'blvd-crawl')?.data).toEqual({ sourceId: 'gen2-blvd-id' })
    expect(extractJobs.find((j) => j.key === 'blvd-extract')?.data).toEqual({ sourceId: 'gen2-blvd-id' })
  }, 20_000)
})
