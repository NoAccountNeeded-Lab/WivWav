import type { FastifyPluginAsync } from 'fastify'
import type { QueueAdapter } from '@wivwav/queue'
import { CRITICAL_JOB_OPTIONS, LISTING_SYNC_REBUILD_JOB_ID, QUEUES, READINESS_BACKFILL_JOB_ID } from '@wivwav/queue'
import { latestCompletedTimestampSeconds } from '../services/queue-job-timestamps.js'

interface AdminSyncOptions {
  queues: Map<string, QueueAdapter>
}

// Search-index full rebuild trigger and last-sync readout.
export const adminSyncRoutes: FastifyPluginAsync<AdminSyncOptions> = async (app, { queues }) => {
  // Enqueue the idempotent one-off readiness backfill on the listing-resolve queue.
  app.post('/readiness-backfill', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    const queue = queues.get(QUEUES.LISTING_RESOLVE)
    if (!queue) return reply.internalServerError('listing-resolve queue is not registered')
    const jobId = await queue.add(
      { readinessBackfill: true },
      { ...CRITICAL_JOB_OPTIONS, removeOnComplete: true, removeOnFail: true, jobId: READINESS_BACKFILL_JOB_ID },
    )
    return reply.code(202).send({ data: { enqueued: true, jobId } })
  })

  // POST /internal/ops/sync — enqueue a full versioned re-index of the listings
  // search projection. The scraper's single-owner indexer job (#669) performs
  // the actual rebuild (versioned index + atomic swap); this route only
  // enqueues it, using the same fixed jobId as the nightly schedule and the
  // gone-listing-sync failure path so a burst of manual triggers collapses
  // into one pending rebuild rather than queuing several serial ones.
  app.post('/sync', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    const queue = queues.get(QUEUES.LISTING_SYNC)
    if (!queue) return reply.internalServerError('listing-sync queue is not registered')
    const jobId = await queue.add({}, { ...CRITICAL_JOB_OPTIONS, jobId: LISTING_SYNC_REBUILD_JOB_ID })
    return reply.code(202).send({ data: { enqueued: true, jobId } })
  })

  // GET /internal/ops/sync — last completed listing-sync job, for operator tooling
  // that wants a "synced N minutes ago" readout without scraping /metrics.
  // Shares its BullMQ lookup with the wivwav_meilisearch_last_sync_timestamp_seconds
  // gauge (routes/metrics.ts) via services/queue-job-timestamps.ts.
  app.get('/sync', async (_req, reply) => {
    const queue = queues.get(QUEUES.LISTING_SYNC)
    if (!queue) return reply.internalServerError('listing-sync queue is not registered')
    try {
      const seconds = await latestCompletedTimestampSeconds(queue)
      const lastSyncCompletedAt = seconds === null ? null : new Date(seconds * 1000).toISOString()
      return reply.send({ data: { lastSyncCompletedAt } })
    } catch (err) {
      app.log.error(err, 'listing-sync queue is unavailable')
      return reply.code(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'listing-sync queue is unavailable' } })
    }
  })
}
