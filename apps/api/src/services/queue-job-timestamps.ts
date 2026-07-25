import type { QueueAdapter } from '@wivwav/queue'

/**
 * Unix timestamp (seconds) of the most recently completed job in a queue, or
 * `null` if the queue has no completed jobs. Shared by the Prometheus scrape
 * endpoint (`routes/metrics.ts`, which reports recency gauges for several
 * queues) and the admin API (`routes/admin.ts`, `GET /admin/sync`) so both
 * surfaces read the same BullMQ `getJobs(['completed'])` query instead of
 * maintaining separate copies.
 *
 * Takes an already-resolved `QueueAdapter` rather than a `QueueFactory` +
 * name so callers that already hold a queue reference (e.g. `admin.ts`'s
 * plugin-scoped `queues` map) don't need to re-resolve it.
 */
export async function latestCompletedTimestampSeconds(queue: QueueAdapter): Promise<number | null> {
  const jobs = await queue.getJobs(['completed'])
  let latestFinishedAtMs: number | null = null
  for (const job of jobs) {
    const finishedAtMs = job.finishedAt?.getTime()
    if (finishedAtMs !== undefined && (latestFinishedAtMs === null || finishedAtMs > latestFinishedAtMs)) {
      latestFinishedAtMs = finishedAtMs
    }
  }
  return latestFinishedAtMs === null ? null : Math.floor(latestFinishedAtMs / 1000)
}
