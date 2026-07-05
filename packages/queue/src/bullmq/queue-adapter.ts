import type { Queue, JobsOptions } from 'bullmq'
import type { QueueAdapter, JobOptions, JobRecord, JobStats, JobStatus, RepeatableJob } from '../types.js'

export class BullMQQueueAdapter implements QueueAdapter {
  readonly name: string

  constructor(private readonly queue: Queue) {
    this.name = queue.name
  }

  async add(data: unknown, options?: JobOptions): Promise<string> {
    const opts: JobsOptions = {}
    if (options?.delay !== undefined) opts.delay = options.delay
    if (options?.attempts !== undefined) opts.attempts = options.attempts
    if (options?.backoff !== undefined) opts.backoff = options.backoff
    if (options?.jobId !== undefined) opts.jobId = options.jobId

    const job = await this.queue.add(this.name, data as object, opts)
    return job.id ?? ''
  }

  async pause(): Promise<void> {
    await this.queue.pause()
  }

  async resume(): Promise<void> {
    await this.queue.resume()
  }

  async isPaused(): Promise<boolean> {
    return this.queue.isPaused()
  }

  async getStats(): Promise<JobStats> {
    const counts = await this.queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    )
    return {
      waiting: counts['waiting'] ?? 0,
      active: counts['active'] ?? 0,
      completed: counts['completed'] ?? 0,
      failed: counts['failed'] ?? 0,
      delayed: counts['delayed'] ?? 0,
    }
  }

  async getJobs(statuses: JobStatus[]): Promise<JobRecord[]> {
    const jobs = await this.queue.getJobs(statuses)
    return Promise.all(
      jobs.map(async (job): Promise<JobRecord> => {
        const id = job.id ?? ''
        const logs = id ? await this.queue.getJobLogs(id, 0, 100) : { logs: [] }
        return {
          id,
          name: job.name,
          data: job.data,
          status: (await job.getState()) as JobStatus,
          createdAt: new Date(job.timestamp),
          ...(job.finishedOn !== undefined && { finishedAt: new Date(job.finishedOn) }),
          ...(job.failedReason !== undefined && { failedReason: job.failedReason }),
          attemptsMade: job.attemptsMade,
          progress: job.progress,
          logs: logs.logs,
        }
      }),
    )
  }

  async getRepeatableJobs(): Promise<RepeatableJob[]> {
    const jobs = await this.queue.getJobSchedulers()
    return jobs.map((j) => ({
      key: j.key,
      name: j.name,
      // Job Scheduler metadata does not populate `id`; the caller-supplied
      // scheduler identity is returned as `key`.
      id: j.key,
      tz: j.tz ?? null,
      pattern: j.pattern ?? null,
      next: j.next ?? null,
      legacy: j.iterationCount === undefined,
    }))
  }

  async addRepeatable(name: string, data: unknown, pattern: string, tz?: string, jobId?: string, options?: JobOptions): Promise<void> {
    const opts: JobsOptions = {}
    if (options?.attempts !== undefined) opts.attempts = options.attempts
    if (options?.backoff !== undefined) opts.backoff = options.backoff
    await this.queue.upsertJobScheduler(
      jobId ?? name,
      { pattern, ...(tz ? { tz } : {}) },
      { name, data: data as object, opts },
    )
  }

  async removeRepeatableByKey(key: string): Promise<boolean> {
    const removed = await this.queue.removeJobScheduler(key)
    if (removed) return true
    // Legacy repeatable hashes can remain after upgrading to the Job Scheduler
    // API. Keep the deprecated removal call only as a migration fallback.
    return this.queue.removeRepeatableByKey(key)
  }

  async cleanFailed(limit = 1000): Promise<number> {
    const removed = await this.queue.clean(0, limit, 'failed')
    return removed.length
  }

  async close(): Promise<void> {
    await this.queue.close()
  }

  /** Exposes the underlying BullMQ Queue — for Bull Board wiring in the admin layer only. */
  getBullMQQueue(): Queue {
    return this.queue
  }
}
