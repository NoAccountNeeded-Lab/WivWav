import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectDb, getDb } from '@wivwav/db'
import type { PrismaClient } from '@wivwav/db'
import { QUEUES } from '@wivwav/queue'
import type { JobContext } from '@wivwav/queue'
import { PrismaJobRunRepository } from './job-run-repository.js'
import { withJobRunTracking } from './job-run-tracking.js'

// Exercises #933's lineage backbone against a real, migrated Postgres:
// every job type index.ts registers goes through the exact same
// withJobRunTracking(jobType, jobRuns, processor) wrapper used here, so
// asserting the wrapper's DB behaviour once per job type covers the real
// wiring without needing to actually run each job's (heavy, networked/
// browser-driven) business logic.
const db: PrismaClient = getDb()

async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe(`TRUNCATE TABLE "job_run", "listings", "sources" RESTART IDENTITY CASCADE`)
}

let sourceCounter = 0
async function createSource() {
  sourceCounter += 1
  return db.source.create({
    data: { name: `JobRun Test Source ${sourceCounter}`, baseUrl: `https://source-${sourceCounter}.example.com` },
  })
}

function makeContext(): JobContext {
  return { log: async () => {}, updateProgress: async () => {} }
}

// Every job type getCanonicalDefs() (apps/api/src/routes/admin.ts) schedules,
// grouped by whether its real job payload carries a sourceId.
const SOURCE_SCOPED_JOB_TYPES = [QUEUES.SOURCE_SCRAPE, QUEUES.DETAIL_CRAWL, QUEUES.DETAIL_EXTRACT]
const GLOBAL_JOB_TYPES = [
  QUEUES.GEOCODE,
  QUEUES.DEDUPLICATE,
  QUEUES.RAWPAGE_CLEANUP,
  QUEUES.VIN_ENRICH,
  QUEUES.LISTING_SYNC,
  QUEUES.NHTSA_RECALLS,
  QUEUES.NHTSA_COMPLAINTS,
  QUEUES.NHTSA_SAFETY_RATINGS,
]

describe('withJobRunTracking + PrismaJobRunRepository (integration)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await resetDb()
    await disconnectDb()
  })

  describe.each(SOURCE_SCOPED_JOB_TYPES)('job type %s (source-scoped)', (jobType) => {
    it('creates a succeeded JobRun row with the job type, status, and sourceId', async () => {
      const source = await createSource()
      const jobRuns = new PrismaJobRunRepository(db)
      const wrapped = withJobRunTracking(jobType, jobRuns, async () => {})

      await wrapped({ sourceId: source.id }, makeContext())

      const rows = await db.jobRun.findMany({ where: { jobType } })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ jobType, sourceId: source.id, status: 'succeeded', parentRunId: null })
      expect(rows[0]!.finishedAt).not.toBeNull()
    })

    it('creates a failed JobRun row with the error message when the processor throws', async () => {
      const source = await createSource()
      const jobRuns = new PrismaJobRunRepository(db)
      const wrapped = withJobRunTracking(jobType, jobRuns, async () => {
        throw new Error(`${jobType} exploded`)
      })

      await expect(wrapped({ sourceId: source.id }, makeContext())).rejects.toThrow(`${jobType} exploded`)

      const rows = await db.jobRun.findMany({ where: { jobType } })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        jobType,
        sourceId: source.id,
        status: 'failed',
        errorMessage: `${jobType} exploded`,
      })
    })
  })

  describe.each(GLOBAL_JOB_TYPES)('job type %s (global, unscoped payload)', (jobType) => {
    it('creates a succeeded JobRun row with a null sourceId', async () => {
      const jobRuns = new PrismaJobRunRepository(db)
      const wrapped = withJobRunTracking(jobType, jobRuns, async () => {})

      await wrapped({}, makeContext())

      const rows = await db.jobRun.findMany({ where: { jobType } })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ jobType, sourceId: null, status: 'succeeded' })
    })
  })

  it('links a spawned run to its parent via context.runId → parentRunId, forming a two-level tree', async () => {
    // Mirrors the real source-scrape → listing-resolve pipeline: the parent
    // processor reads context.runId and passes it as the child job's
    // parentRunId (see index.ts's SOURCE_SCRAPE worker).
    const source = await createSource()
    const jobRuns = new PrismaJobRunRepository(db)

    let childData: { parentRunId: string | null } = { parentRunId: null }
    const parentProcessor = withJobRunTracking(QUEUES.SOURCE_SCRAPE, jobRuns, async (_data, context) => {
      childData = { parentRunId: context.runId ?? null }
    })
    await parentProcessor({ sourceId: source.id }, makeContext())

    const childProcessor = withJobRunTracking(QUEUES.LISTING_RESOLVE, jobRuns, async () => {})
    await childProcessor(childData, makeContext())

    const rows = await db.jobRun.findMany({ orderBy: { startedAt: 'asc' } })
    expect(rows).toHaveLength(2)
    const [parent, child] = rows
    expect(parent).toMatchObject({ jobType: QUEUES.SOURCE_SCRAPE, sourceId: source.id, parentRunId: null })
    expect(child).toMatchObject({ jobType: QUEUES.LISTING_RESOLVE, sourceId: null, parentRunId: parent!.id })
  })
})
