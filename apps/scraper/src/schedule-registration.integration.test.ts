import { afterAll, describe, expect, it } from 'vitest'
import { BullMQQueueFactory, CRITICAL_JOB_OPTIONS } from '@wivwav/queue'
import type { QueueAdapter } from '@wivwav/queue'
import { buildDetailScheduleDefinitions, reconcileSchedules } from './schedule-registration.js'

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
// `pnpm --filter @wivwav/scraper test:integration`.
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
