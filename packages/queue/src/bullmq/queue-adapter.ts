import type { Job, Queue, JobsOptions } from 'bullmq'
import type {
  QueueAdapter,
  JobOptions,
  JobRecord,
  JobStats,
  JobStatus,
  QueuedJobActionResult,
  RepeatableJob,
} from '../types.js'
import type { QueuePolicy } from '../policies.js'
import { REMOVE_QUEUED_SCRIPT } from './remove-queued.lua.js'

// BullMQ ErrorCode values (enums/error-code) this adapter knows how to translate.
const BULLMQ_JOB_NOT_EXIST = -1
const BULLMQ_JOB_NOT_IN_STATE = -3

export class BullMQQueueAdapter implements QueueAdapter {
  readonly name: string

  constructor(
    private readonly queue: Queue,
    private readonly policy: QueuePolicy,
  ) {
    this.name = queue.name
  }

  async add(data: unknown, options?: JobOptions): Promise<string> {
    const opts: JobsOptions = {}
    if (options?.delay !== undefined) opts.delay = options.delay
    if (options?.attempts !== undefined) opts.attempts = options.attempts
    if (options?.backoff !== undefined) opts.backoff = options.backoff
    if (options?.jobId !== undefined) opts.jobId = options.jobId
    opts.removeOnComplete = options?.removeOnComplete ?? this.policy.retention.completed
    opts.removeOnFail = options?.removeOnFail ?? this.policy.retention.failed

    const job = await this.queue.add(this.name, data as object, opts)
    return job.id ?? ''
  }

  getPolicy(): QueuePolicy {
    return this.policy
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
      data: j.template?.data,
    }))
  }

  async addRepeatable(name: string, data: unknown, pattern: string, tz?: string, jobId?: string, options?: JobOptions): Promise<void> {
    const opts: JobsOptions = {}
    if (options?.attempts !== undefined) opts.attempts = options.attempts
    if (options?.backoff !== undefined) opts.backoff = options.backoff
    opts.removeOnComplete = options?.removeOnComplete ?? this.policy.retention.completed
    opts.removeOnFail = options?.removeOnFail ?? this.policy.retention.failed
    await this.queue.upsertJobScheduler(
      jobId ?? name,
      { pattern, ...(tz ? { tz } : {}) },
      { name, data: data as object, opts },
    )
  }

  async removeRepeatableByKey(key: string): Promise<boolean> {
    return this.queue.removeJobScheduler(key)
  }

  async cleanFailed(limit = 1000): Promise<number> {
    const removed = await this.queue.clean(0, limit, 'failed')
    return removed.length
  }

  async removeQueued(jobId: string): Promise<QueuedJobActionResult> {
    const client = await this.queue.backend.client
    // Idempotent: redefining a named command just replaces it.
    client.defineCommand('wivwavRemoveQueued', { numberOfKeys: 0, lua: REMOVE_QUEUED_SCRIPT })
    const [code, state] = (await client.runCommand('wivwavRemoveQueued', [
      this.queue.toKey(''),
      jobId,
      this.queue.toKey('repeat'),
    ])) as [number, string]
    if (code === 1) return { outcome: 'ok' }
    if (code === 0) return { outcome: 'not_found' }
    if (code === -1) return { outcome: 'conflict', reason: 'Job is running on a worker' }
    if (code === -8) return { outcome: 'conflict', reason: 'Job is the next scheduled run; change the schedule instead' }
    if (code === -2) return { outcome: 'conflict', reason: `Job is ${state}, not queued` }
    throw new Error(`Unexpected remove-queued result ${code}`)
  }

  async retryFailed(jobId: string): Promise<QueuedJobActionResult> {
    // Attempts are reset: a job that exhausted its budget would otherwise get
    // exactly one more try, which is not what an operator pressing Retry expects.
    return this.act(jobId, 'failed', (job) => job.retry('failed', { resetAttemptsMade: true }))
  }

  async makeReady(jobId: string): Promise<QueuedJobActionResult> {
    return this.act(jobId, 'delayed', (job) => job.promote())
  }

  /**
   * BullMQ's retry/promote scripts check existence and state atomically, so no
   * pre-read is trusted. Only the codes handled here are translated
   * (JOB_NOT_EXIST -1, JOB_NOT_IN_STATE -3); anything else is rethrown.
   */
  private async act(
    jobId: string,
    wanted: string,
    run: (job: Job) => Promise<void>,
  ): Promise<QueuedJobActionResult> {
    const job = await this.queue.getJob(jobId)
    if (!job) return { outcome: 'not_found' }
    try {
      await run(job)
      return { outcome: 'ok' }
    } catch (err) {
      const code = (err as { code?: unknown }).code
      if (code === BULLMQ_JOB_NOT_EXIST) return { outcome: 'not_found' }
      if (code === BULLMQ_JOB_NOT_IN_STATE) {
        const now = await this.queue.getJob(jobId)
        if (!now) return { outcome: 'not_found' }
        return { outcome: 'conflict', reason: `Job is ${await now.getState()}, not ${wanted}` }
      }
      throw err
    }
  }

  async close(): Promise<void> {
    // BullMQ's `Queue#close()` only force-disconnects when the underlying
    // ioredis client never reached "ready" (e.g. the backend never replied to
    // the initial handshake) — otherwise it falls back to a graceful
    // `QUIT`, which itself waits on a reply the backend may never send if it
    // went unresponsive *after* becoming ready (#995). `Queue#disconnect()`
    // has the complementary gap: it force-disconnects once the client is
    // ready, but hangs awaiting that same not-yet-ready client if the
    // handshake never completed. Racing both covers every connection state:
    // whichever one is safe to call synchronously for the current status
    // wins and tears down the socket; the other is simply abandoned.
    await Promise.race([this.queue.close(), this.queue.disconnect()])
  }

  /** Exposes the underlying BullMQ Queue — for Bull Board wiring in the admin layer only. */
  getBullMQQueue(): Queue {
    return this.queue
  }
}
