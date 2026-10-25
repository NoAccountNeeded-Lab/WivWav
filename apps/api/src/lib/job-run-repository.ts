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
  queueJobId: string | null
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
  /**
   * `stats` is optional here for the same reason it is on `succeed`: a
   * processor that throws partway through (e.g. detail-extract's partial
   * page-extraction failure) can still know how much of its batch succeeded
   * before the failure, and that count is worth keeping on the row.
   */
  fail(id: string, errorMessage: string, stats?: JobRunFinishStats): Promise<void>
}

export interface RunningJobRun {
  id: string
  jobType: string
  queueJobId: string | null
  startedAt: Date
}

export interface AbandonableJobRunRepository extends JobRunRepository {
  findRunningBefore(startedBefore: Date): Promise<RunningJobRun[]>
  abandonIfRunning(id: string): Promise<boolean>
}

export class PrismaJobRunRepository implements AbandonableJobRunRepository {
  constructor(private readonly db: PrismaClient) {}

  async start({ jobType, queueJobId, sourceId, parentRunId }: JobRunStartInput): Promise<JobRunRecord> {
    return this.db.jobRun.create({
      data: { jobType, queueJobId, sourceId, parentRunId, startedAt: new Date() },
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

  async fail(id: string, errorMessage: string, stats?: JobRunFinishStats): Promise<void> {
    await this.db.jobRun.update({
      where: { id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorMessage,
        ...(stats ? { succeededCount: stats.succeededCount ?? null, failedCount: stats.failedCount ?? null } : {}),
      },
    })
  }

  async findRunningBefore(startedBefore: Date): Promise<RunningJobRun[]> {
    return this.db.jobRun.findMany({
      where: { status: 'running', startedAt: { lt: startedBefore } },
      select: { id: true, jobType: true, queueJobId: true, startedAt: true },
      orderBy: { startedAt: 'asc' },
    })
  }

  async abandonIfRunning(id: string): Promise<boolean> {
    const result = await this.db.jobRun.updateMany({
      where: { id, status: 'running' },
      data: { status: 'failed', finishedAt: new Date(), errorMessage: 'abandoned' },
    })
    return result.count === 1
  }
}
