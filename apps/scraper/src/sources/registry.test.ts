import { describe, it, expect, vi } from 'vitest'
import { SCRAPER_SOURCE_REGISTRY } from '@wivwav/types'
import { MockQueueAdapter, QUEUES, CRITICAL_JOB_OPTIONS } from '@wivwav/queue'
import type { ScheduleIntent } from '@wivwav/db'
import {
  registerSources,
  buildSourceScrapeScheduleSources,
  buildDetailScheduleSources,
  type RegisteredSource,
} from './registry.js'
import { applyScheduleIntents, buildDetailScheduleDefinitions, reconcileSchedules } from '../schedule-registration.js'
import { FREEDOM_MOTORS_DETAIL_MAPPINGS } from './freedom-motors-detail-mappings.js'

function makeRow(name: string, id: string) {
  return {
    id,
    name,
    baseUrl: '',
    cronExpression: '0 * * * *',
    timezone: 'UTC',
    fingerprintHash: null,
    page1Hash: null,
  }
}

describe('registerSources — default mappings seeding (#822)', () => {
  it('seeds FREEDOM_MOTORS_DETAIL_MAPPINGS only for the freedom-motors source on first create', async () => {
    const upsert = vi.fn().mockImplementation(({ where }: { where: { name: string } }) =>
      Promise.resolve(makeRow(where.name, where.name)),
    )
    const db = { source: { upsert } } as never
    const engine = { register: vi.fn() } as never
    const browserService = {} as never

    await registerSources(db, engine, browserService)

    const freedomMotorsCall = upsert.mock.calls.find((call) => call[0].where.name === 'Freedom Motors')
    expect(freedomMotorsCall![0].create.mappings).toEqual(FREEDOM_MOTORS_DETAIL_MAPPINGS)

    // No other source gets a default mappings seed — a bespoke-parser source
    // (BLVD, MobilityWorks) has no use for one, and Superior Van stays
    // scrape-only until its own dependent issue flips its pipeline.
    const otherCalls = upsert.mock.calls.filter((call) => call[0].where.name !== 'Freedom Motors')
    expect(otherCalls.length).toBeGreaterThan(0)
    for (const call of otherCalls) {
      expect(call[0].create.mappings).toBeUndefined()
    }
  })

  it('never overwrites an existing row — update stays empty regardless of defaults', async () => {
    const upsert = vi.fn().mockResolvedValue(makeRow('Freedom Motors', 'existing-id'))
    const db = { source: { upsert } } as never
    const engine = { register: vi.fn() } as never
    const browserService = {} as never

    await registerSources(db, engine, browserService)

    for (const call of upsert.mock.calls) {
      expect(call[0].update).toEqual({})
    }
  })
})

describe('buildDetailScheduleSources — Freedom Motors registers under detail-pages (#822)', () => {
  it('includes freedom-motors now that its pipeline is detail-pages', () => {
    const sources: RegisteredSource[] = SCRAPER_SOURCE_REGISTRY.map((definition) => ({
      definition,
      row: makeRow(definition.name, definition.key),
    }))

    const detailSources = buildDetailScheduleSources(sources)
    expect(detailSources.map((s) => s.schedulerPrefix)).toContain('freedom-motors')
  })
})

describe('detail-crawl/detail-extract jobIds never collide with card-scrape jobIds or each other (#635 pattern)', () => {
  it('produces a fully distinct jobId per (source, job-kind) across the whole registry', () => {
    const sources: RegisteredSource[] = SCRAPER_SOURCE_REGISTRY.map((definition) => ({
      definition,
      row: makeRow(definition.name, definition.key),
    }))

    const cardScrapeJobIds = buildSourceScrapeScheduleSources(sources).map((s) => s.jobId)

    const detailSources = buildDetailScheduleSources(sources)
    const detailDefinitions = buildDetailScheduleDefinitions(
      detailSources,
      { crawl: { name: 'crawl' } as never, extract: { name: 'extract' } as never },
      {},
    )
    const detailJobIds = detailDefinitions.map((d) => d.jobId).filter((id): id is string => id !== undefined)

    // Freedom Motors specifically must not collide with its own card-scrape
    // jobId ('freedom-motors') now that it also has detail-crawl/detail-extract
    // schedules.
    expect(cardScrapeJobIds).toContain('freedom-motors')
    expect(detailJobIds).toContain('freedom-motors-crawl')
    expect(detailJobIds).toContain('freedom-motors-extract')

    const allJobIds = [...cardScrapeJobIds, ...detailJobIds]
    expect(new Set(allJobIds).size).toBe(allJobIds.length)
  })

  it('respects source disablement the same way as every other detail-pages source (shared reconcileSchedules gate)', async () => {
    // Freedom Motors gets no bespoke scheduling code path — it flows through
    // the exact same buildDetailScheduleDefinitions()/reconcileSchedules()
    // machinery as BLVD/MobilityWorks. Exercise that machinery end-to-end
    // (not just assert the pipeline flag) to prove an operator disabling
    // Freedom Motors actually removes its detail-crawl/detail-extract
    // repeatable jobs, the same as it would for any other source.
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const crawl = new MockQueueAdapter(QUEUES.DETAIL_CRAWL)
    const extract = new MockQueueAdapter(QUEUES.DETAIL_EXTRACT)
    const sources: RegisteredSource[] = SCRAPER_SOURCE_REGISTRY.filter(
      (definition) => definition.pipeline === 'detail-pages',
    ).map((definition) => ({ definition, row: makeRow(definition.name, definition.key) }))
    const detailSources = buildDetailScheduleSources(sources)

    const definitions = buildDetailScheduleDefinitions(detailSources, { crawl, extract }, CRITICAL_JOB_OPTIONS)
    await reconcileSchedules(definitions, logger)

    const beforeDisable = await crawl.getRepeatableJobs()
    expect(beforeDisable.map((j) => j.id)).toContain('freedom-motors-crawl')

    const intents = new Map<string, ScheduleIntent>([
      ['freedom-motors-crawl', { enabled: false, updatedAt: new Date().toISOString() }],
      ['freedom-motors-extract', { enabled: false, updatedAt: new Date().toISOString() }],
    ])
    const intentDefinitions = applyScheduleIntents(definitions, intents)
    await reconcileSchedules(intentDefinitions, logger)

    const afterDisable = await crawl.getRepeatableJobs()
    const afterDisableExtract = await extract.getRepeatableJobs()
    expect(afterDisable.map((j) => j.id)).not.toContain('freedom-motors-crawl')
    expect(afterDisableExtract.map((j) => j.id)).not.toContain('freedom-motors-extract')
    // BLVD/MobilityWorks are untouched by disabling Freedom Motors specifically.
    expect(afterDisable.map((j) => j.id)).toEqual(expect.arrayContaining(['blvd-crawl', 'mw-crawl']))
  })
})
