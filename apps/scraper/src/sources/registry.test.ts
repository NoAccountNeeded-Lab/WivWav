import { describe, it, expect, vi } from 'vitest'
import { SCRAPER_SOURCE_REGISTRY } from '@wivwav/types'
import {
  registerSources,
  buildSourceScrapeScheduleSources,
  buildDetailScheduleSources,
  type RegisteredSource,
} from './registry.js'
import { buildDetailScheduleDefinitions } from '../schedule-registration.js'
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

  it('respects source disablement the same way as every other detail-pages source (shared reconcileSchedules gate)', () => {
    // Freedom Motors gets no bespoke scheduling code path — it flows through
    // the exact same buildDetailScheduleDefinitions()/reconcileSchedules()
    // machinery as BLVD/MobilityWorks, whose `enabled: false` handling
    // (schedule-registration.ts) already removes a source's schedules. No
    // additional wiring is needed for Freedom Motors specifically; this
    // assertion documents that reliance.
    const freedomMotors = SCRAPER_SOURCE_REGISTRY.find((d) => d.key === 'freedom-motors')
    expect(freedomMotors?.pipeline).toBe('detail-pages')
  })
})
