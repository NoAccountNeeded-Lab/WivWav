import type {
  QueueFactory,
  QueueAdapter,
  WorkerAdapter,
  JobProcessor,
  JobOptions,
  JobRecord,
  JobStats,
  JobStatus,
  QueuedJobActionResult,
  RepeatableJob,
  WorkerOptions,
} from '../types.js'
import { getQueuePolicy } from '../policies.js'

interface StoredJob {
  id: string
  data: unknown
  options: JobOptions | undefined
  status: JobStatus
  createdAt: Date
  failedReason: string | undefined
  attemptsMade: number
  progress: unknown
  logs: string[]
}

export class MockQueueAdapter implements QueueAdapter {
  readonly name: string
  private jobs: StoredJob[] = []
  private repeatableJobs: RepeatableJob[] = []
  private paused = false
  private counter = 0

  constructor(name: string) {
    this.name = name
  }

  getPolicy() {
    return getQueuePolicy(this.name)
  }

  async add(data: unknown, options?: JobOptions): Promise<string> {
    if (options?.jobId !== undefined) {
      const existing = this.jobs.find(
        (j) =>
          j.options?.jobId === options.jobId &&
          (j.status === 'waiting' || j.status === 'active' || j.status === 'delayed'),
      )
      if (existing) return existing.id
    }

    const id = String(++this.counter)
    this.jobs.push({
      id,
      data,
      options,
      status: 'waiting',
      createdAt: new Date(),
      attemptsMade: 0,
      failedReason: undefined,
      progress: 0,
      logs: [],
    })
    return id
  }

  async pause(): Promise<void> {
    this.paused = true
  }

  async resume(): Promise<void> {
    this.paused = false
  }

  async isPaused(): Promise<boolean> {
    return this.paused
  }

  async getStats(): Promise<JobStats> {
    const count = (s: JobStatus) => this.jobs.filter((j) => j.status === s).length
    return {
      waiting: count('waiting'),
      active: count('active'),
      completed: count('completed'),
      failed: count('failed'),
      delayed: count('delayed'),
    }
  }

  async getJobs(statuses: JobStatus[]): Promise<JobRecord[]> {
    return this.jobs
      .filter((j) => statuses.includes(j.status))
      .map((j): JobRecord => ({
        id: j.id,
        name: this.name,
        data: j.data,
        status: j.status,
        createdAt: j.createdAt,
        attemptsMade: j.attemptsMade,
        progress: j.progress,
        logs: [...j.logs],
        ...(j.failedReason !== undefined && { failedReason: j.failedReason }),
      }))
  }

  async getJobLiveness(jobId: string) {
    const job = this.jobs.find((candidate) => candidate.id === jobId)
    if (!job) return 'gone' as const
    return job.status === 'active' ? 'live' as const : 'live' as const
  }

  async getRepeatableJobs(): Promise<RepeatableJob[]> {
    return this.repeatableJobs.map((job) => ({ ...job }))
  }

  async addRepeatable(
    name: string,
    data: unknown,
    pattern: string,
    tz?: string,
    jobId?: string,
    _options?: JobOptions,
  ): Promise<void> {
    const key = jobId ?? name
    const repeatable: RepeatableJob = {
      key,
      name,
      id: key,
      tz: tz ?? null,
      pattern,
      next: Date.now() + 60_000,
      legacy: false,
      data,
    }
    const index = this.repeatableJobs.findIndex((job) => job.key === key)
    if (index === -1) this.repeatableJobs.push(repeatable)
    else this.repeatableJobs[index] = repeatable
  }

  async removeRepeatableByKey(key: string): Promise<boolean> {
    const initialLength = this.repeatableJobs.length
    this.repeatableJobs = this.repeatableJobs.filter((job) => job.key !== key)
    return this.repeatableJobs.length !== initialLength
  }

  async cleanFailed(_limit?: number): Promise<number> {
    return 0
  }

  private transition(
    jobId: string,
    from: JobStatus[],
    apply: (job: StoredJob) => void,
  ): QueuedJobActionResult {
    const job = this.jobs.find((j) => j.id === jobId)
    if (!job) return { outcome: 'not_found' }
    if (!from.includes(job.status)) {
      return { outcome: 'conflict', reason: `Job is ${job.status}, not ${from.join(' or ')}` }
    }
    apply(job)
    return { outcome: 'ok' }
  }

  async removeQueued(jobId: string): Promise<QueuedJobActionResult> {
    return this.transition(jobId, ['waiting', 'delayed'], (job) => {
      this.jobs = this.jobs.filter((j) => j !== job)
    })
  }

  async retryFailed(jobId: string): Promise<QueuedJobActionResult> {
    return this.transition(jobId, ['failed'], (job) => {
      job.status = 'waiting'
      job.attemptsMade = 0
      job.failedReason = undefined
    })
  }

  async makeReady(jobId: string): Promise<QueuedJobActionResult> {
    return this.transition(jobId, ['delayed'], (job) => {
      job.status = 'waiting'
    })
  }

  async close(): Promise<void> {}

  /** Test helper: move the most recently added job to delayed. */
  markDelayed(): void {
    const job = this.jobs.at(-1)
    if (!job) throw new Error('markDelayed: no jobs have been added yet')
    job.status = 'delayed'
  }

  /** Test helper: mark the most recently added job as active. */
  markActive(): void {
    const job = this.jobs.at(-1)
    if (!job) throw new Error('markActive: no jobs have been added yet')
    job.status = 'active'
  }

  /** Test helper: all jobs enqueued so far. */
  getEnqueued(): StoredJob[] {
    return [...this.jobs]
  }

  /** Test helper: mark the most recently added job as failed with a reason, for exercising failed-job read paths (e.g. explain-error). */
  markFailed(failedReason: string, attemptsMade = 1): void {
    const job = this.jobs.at(-1)
    if (!job) throw new Error('markFailed: no jobs have been added yet')
    job.status = 'failed'
    job.failedReason = failedReason
    job.attemptsMade = attemptsMade
  }

  /** Test helper: mark the most recently added job as completed. */
  markCompleted(): void {
    const job = this.jobs.at(-1)
    if (!job) throw new Error('markCompleted: no jobs have been added yet')
    job.status = 'completed'
  }

  /** Test helper: seed BullMQ repeatable metadata, including legacy entries. */
  seedRepeatable(job: RepeatableJob): void {
    this.repeatableJobs.push({ ...job })
  }

  /** Test helper: reset state between tests. */
  clear(): void {
    this.jobs = []
    this.repeatableJobs = []
    this.counter = 0
  }
}

class MockWorkerAdapter implements WorkerAdapter {
  async close(): Promise<void> {}
}

export class MockQueueFactory implements QueueFactory {
  private readonly queues = new Map<string, MockQueueAdapter>()

  createQueue(name: string): QueueAdapter {
    let queue = this.queues.get(name)
    if (!queue) {
      queue = new MockQueueAdapter(name)
      this.queues.set(name, queue)
    }
    return queue
  }

  createWorker<T = unknown>(
    _name: string,
    _processor: JobProcessor<T>,
    _options?: WorkerOptions,
  ): WorkerAdapter {
    return new MockWorkerAdapter()
  }

  async close(): Promise<void> {}

  /** Test helper: get the MockQueueAdapter for a named queue. */
  getQueue(name: string): MockQueueAdapter | undefined {
    return this.queues.get(name)
  }
}
