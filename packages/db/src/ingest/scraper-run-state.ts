import type { PrismaClient } from '../generated/prisma/index.js'

/**
 * ScraperRun lifecycle writes (#948/#951): shared by apps/api's admin-oriented
 * PrismaScraperRunRepository and its worker gateway, one implementation
 * instead of a hand-copied port.
 *
 * Dual-write (#1073): every source-scrape execution is recorded in both
 * `ScraperRun` (legacy per-source table, carries the mark-gone idempotency
 * marker) and `JobRun` (#933 lineage backbone) under one shared id, so the
 * `listing.runId` the worker threads through upserts satisfies
 * `listings_lastRunId_fkey`. Without the `JobRun` row, every listing create
 * fails with P2003 and the whole source-scrape job fails.
 *
 * `SOURCE_SCRAPE_JOB_TYPE` duplicates `QUEUES.SOURCE_SCRAPE`
 * (`packages/queue/src/queues.ts`): @wivwav/db must not depend on @wivwav/queue,
 * so the literal lives here with this pointer instead of an import.
 */

const SOURCE_SCRAPE_JOB_TYPE = 'source-scrape'

export interface ScraperRunRecord {
  id: string
}

export async function startScraperRun(
  db: PrismaClient,
  sourceId: string,
): Promise<ScraperRunRecord> {
  return db.$transaction(async (tx) => {
    const run = await tx.scraperRun.create({ data: { sourceId, startedAt: new Date() } })
    await tx.jobRun.create({
      data: {
        id: run.id,
        jobType: SOURCE_SCRAPE_JOB_TYPE,
        sourceId,
        startedAt: run.startedAt,
      },
    })
    return { id: run.id }
  })
}

export async function completeScraperRun(
  db: PrismaClient,
  id: string,
  listingsFound: number,
  changes: { listingsNew: number; listingsUpdated: number } = {
    listingsNew: 0,
    listingsUpdated: 0,
  },
): Promise<void> {
  const finishedAt = new Date()
  await db.scraperRun.update({
    where: { id },
    data: { finishedAt, success: true, listingsFound, ...changes },
  })
  // Best-effort mirror onto the dual-written JobRun row (#1073):
  // updateMany (not update) so completing a pre-dual-write ScraperRun never
  // throws. Counts stay null — mapping scrape tallies onto
  // succeededCount/failedCount is a #937-stats concern, out of scope here.
  await db.jobRun.updateMany({
    where: { id },
    data: { status: 'succeeded', finishedAt },
  })
}

export async function failScraperRun(
  db: PrismaClient,
  id: string,
  errorMessage: string,
): Promise<void> {
  const finishedAt = new Date()
  await db.scraperRun.update({
    where: { id },
    data: { finishedAt, success: false, errorMessage },
  })
  // Same best-effort mirror as completeScraperRun above.
  await db.jobRun.updateMany({
    where: { id },
    data: { status: 'failed', finishedAt, errorMessage },
  })
}
