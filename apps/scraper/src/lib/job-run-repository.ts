import type { PrismaClient } from '@wivwav/db'

/**
 * #933 lineage backbone — write side. Records one `JobRun` row per job
 * execution across every job type (not just source-scrape). Read-side
 * querying (the source run-tree API) lives in its own repository under
 * `apps/api/src/repositories/job-run-repository.ts`, matching this repo's
 * existing split between scraper (writer) and api (reader) for `ScraperRun`.
 */
export interface JobRunStartInput {
  jobType: string
  /** Set when the run's work is attributable to a single source; null for global jobs. */
  sourceId: string | null
  /** Set when this run was spawned by another run, linking the two into one pipeline tree. */
  parentRunId: string | null
}

export interface JobRunRecord {
  id: string
}

export interface JobRunFinishStats {
  succeededCount?: number
  failedCount?: number
}

export interface JobRunRepository {
  start(input: JobRunStartInput): Promise<JobRunRecord>
  succeed(id: string, stats?: JobRunFinishStats): Promise<void>
  fail(id: string, errorMessage: string): Promise<void>
}

export class PrismaJobRunRepository implements JobRunRepository {
  constructor(private readonly db: PrismaClient) {}

  async start({ jobType, sourceId, parentRunId }: JobRunStartInput): Promise<JobRunRecord> {
    return this.db.jobRun.create({
      data: { jobType, sourceId, parentRunId, startedAt: new Date() },
      select: { id: true },
    })
  }

  async succeed(id: string, stats?: JobRunFinishStats): Promise<void> {
    await this.db.jobRun.update({
      where: { id },
      data: {
        status: 'succeeded',
        finishedAt: new Date(),
        succeededCount: stats?.succeededCount ?? null,
        failedCount: stats?.failedCount ?? null,
      },
    })
  }

  async fail(id: string, errorMessage: string): Promise<void> {
    await this.db.jobRun.update({
      where: { id },
      data: { status: 'failed', finishedAt: new Date(), errorMessage },
    })
  }
}
