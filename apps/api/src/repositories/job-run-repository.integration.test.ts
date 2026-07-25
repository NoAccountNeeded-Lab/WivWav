import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { QUEUES } from '@wivwav/queue'
import { PrismaJobRunRepository } from './job-run-repository.js'
import { closeIntegrationDb, createSource, integrationDb, resetIntegrationDb } from '../test-support/integration-db.js'

// Exercises the recursive-CTE tree query against a real, migrated Postgres —
// object-shape assembly is easy to get right in isolation but the SQL join
// direction (parent → descendants) is exactly the kind of thing that's silently
// wrong without hitting a real DB.
describe('PrismaJobRunRepository (integration)', () => {
  const db = integrationDb()
  const repo = new PrismaJobRunRepository(db)

  beforeEach(async () => {
    await resetIntegrationDb(db)
  })

  afterAll(async () => {
    await resetIntegrationDb(db)
    await closeIntegrationDb()
  })

  it('returns an empty forest for a source with no runs', async () => {
    const source = await createSource(db)
    const runs = await repo.findRunTreeForSource(source.id)
    expect(runs).toEqual([])
  })

  it('nests a spawned run under its source-scoped parent, three levels deep', async () => {
    const source = await createSource(db)
    const other = await createSource(db)

    // Unrelated run for a different source must not appear.
    await db.jobRun.create({ data: { jobType: QUEUES.SOURCE_SCRAPE, sourceId: other.id } })

    const scrape = await db.jobRun.create({
      data: { jobType: QUEUES.SOURCE_SCRAPE, sourceId: source.id, status: 'succeeded' },
    })
    const extract = await db.jobRun.create({
      data: { jobType: QUEUES.DETAIL_EXTRACT, sourceId: source.id, parentRunId: scrape.id, status: 'succeeded' },
    })
    // A spawned run's own payload may carry no sourceId — it's still part of
    // this source's tree because it's a descendant of a source-scoped run.
    const resolve = await db.jobRun.create({
      data: { jobType: QUEUES.LISTING_RESOLVE, sourceId: null, parentRunId: extract.id, status: 'succeeded' },
    })

    const runs = await repo.findRunTreeForSource(source.id)

    expect(runs).toHaveLength(1)
    expect(runs[0]!.id).toBe(scrape.id)
    expect(runs[0]!.children).toHaveLength(1)
    expect(runs[0]!.children[0]!.id).toBe(extract.id)
    expect(runs[0]!.children[0]!.children).toHaveLength(1)
    expect(runs[0]!.children[0]!.children[0]!.id).toBe(resolve.id)
  })

  it('returns multiple independent root runs for the same source, each with its own subtree', async () => {
    const source = await createSource(db)

    const scrapeRun1 = await db.jobRun.create({ data: { jobType: QUEUES.SOURCE_SCRAPE, sourceId: source.id } })
    await db.jobRun.create({
      data: { jobType: QUEUES.LISTING_RESOLVE, parentRunId: scrapeRun1.id },
    })
    const scrapeRun2 = await db.jobRun.create({ data: { jobType: QUEUES.SOURCE_SCRAPE, sourceId: source.id } })

    const runs = await repo.findRunTreeForSource(source.id)

    expect(runs.map((r) => r.id).sort()).toEqual([scrapeRun1.id, scrapeRun2.id].sort())
    const run1 = runs.find((r) => r.id === scrapeRun1.id)!
    const run2 = runs.find((r) => r.id === scrapeRun2.id)!
    expect(run1.children).toHaveLength(1)
    expect(run2.children).toHaveLength(0)
  })
})
