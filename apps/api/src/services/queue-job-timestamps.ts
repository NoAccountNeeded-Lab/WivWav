import type { QueueFactory } from '@wivwav/queue'

/**
 * Unix timestamp (seconds) of the most recently completed job in a queue, or
 * `null` if the queue has no completed jobs. Shared by the Prometheus scrape
 * endpoint (`routes/metrics.ts`, which reports recency gauges for several
 * queues) and the admin API (`routes/admin.ts`, `GET /admin/sync`) so both
 * surfaces read the same BullMQ `getJobs(['completed'])` query instead of
 * maintaining separate copies.
 */
export async function latestCompletedTimestampSeconds(queueFactory: QueueFactory, queueName: string): Promise<number | null> {
  const jobs = await queueFactory.createQueue(queueName).getJobs(['completed'])
  const latestFinishedAt = jobs.reduce<number>((latest, job) => {
    const finishedAt = job.finishedAt?.getTime() ?? 0
    return Math.max(latest, finishedAt)
  }, 0)
  return latestFinishedAt > 0 ? Math.floor(latestFinishedAt / 1000) : null
}
