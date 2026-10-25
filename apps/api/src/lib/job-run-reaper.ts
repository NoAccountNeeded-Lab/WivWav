import { QUEUES, type JobLiveness, type QueueFactory } from '@wivwav/queue'
import type { AbandonableJobRunRepository } from './job-run-repository.js'

export interface JobRunReaperStats {
  reapedCount: number
  runningTooLongCount: number
}

export class JobRunReaper {
  private stats: JobRunReaperStats = { reapedCount: 0, runningTooLongCount: 0 }
  private readonly queues = new Map<string, ReturnType<QueueFactory['createQueue']>>()

  constructor(
    private readonly jobRuns: Pick<AbandonableJobRunRepository, 'findRunningBefore' | 'abandonIfRunning'>,
    queueFactory: QueueFactory,
    private readonly maxAgeMs: number,
  ) {
    for (const name of Object.values(QUEUES)) this.queues.set(name, queueFactory.createQueue(name))
  }

  getStats(): JobRunReaperStats {
    return { ...this.stats }
  }

  async run(now = new Date()): Promise<JobRunReaperStats> {
    const candidates = await this.jobRuns.findRunningBefore(new Date(now.getTime() - this.maxAgeMs))
    let reapedCount = 0
    let runningTooLongCount = 0
    for (const run of candidates) {
      const liveness = await this.liveness(run.jobType, run.queueJobId)
      if (liveness === 'live') {
        runningTooLongCount += 1
        continue
      }
      if (await this.jobRuns.abandonIfRunning(run.id)) reapedCount += 1
    }
    this.stats = { reapedCount, runningTooLongCount }
    return this.getStats()
  }

  private async liveness(jobType: string, queueJobId: string | null): Promise<JobLiveness> {
    if (!queueJobId) return 'gone'
    const queue = this.queues.get(jobType)
    if (!queue) return 'live'
    return queue.getJobLiveness(queueJobId)
  }
}
