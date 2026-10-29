import type { FastifyPluginAsync } from 'fastify'
import type { QueueAdapter, QueueFactory } from '@wivwav/queue'
import { QUEUES } from '@wivwav/queue'
import type { PrismaClient } from '@wivwav/db'
import type { ConfigService } from '../services/config-service.js'
import type { JobRunReaper } from '../lib/job-run-reaper.js'
import type {
  JobRunRepository,
  ListingRepository,
  ScraperRunRepository,
  SourceRepository,
} from '../repositories/index.js'
import { adminListingRefreshRoutes } from './admin-listing-refresh.js'
import { adminModerationRoutes } from './admin-moderation.js'
import { adminQueueRoutes } from './admin-queues.js'
import { adminRepeatableRoutes } from './admin-repeatables.js'
import { adminSourceRoutes } from './admin-sources.js'
import { adminSyncRoutes } from './admin-sync.js'

interface AdminPluginOptions {
  db: PrismaClient
  listings: ListingRepository
  operatorConfig?: ConfigService
  sources: SourceRepository
  scraperRuns: ScraperRunRepository
  jobRuns: JobRunRepository
  queueFactory: QueueFactory
  jobRunReaper?: JobRunReaper
}

// Composition entry point for the ops routes mounted under /admin (auth is
// applied by the parent scope in app.ts). Each capability lives in its own
// module and shares one queue-adapter map so every queue is created once.
export const adminRoutes: FastifyPluginAsync<AdminPluginOptions> = async (
  app,
  { db, listings, operatorConfig, sources, scraperRuns, jobRuns, queueFactory, jobRunReaper },
) => {
  const queues = new Map<string, QueueAdapter>()
  for (const name of Object.values(QUEUES)) {
    queues.set(name, queueFactory.createQueue(name))
  }

  await app.register(adminQueueRoutes, { queues })
  await app.register(adminSourceRoutes, {
    db,
    listings,
    ...(operatorConfig ? { operatorConfig } : {}),
    sources,
    scraperRuns,
    jobRuns,
    queues,
  })
  await app.register(adminSyncRoutes, { queues })
  await app.register(adminModerationRoutes, { listings })
  await app.register(adminListingRefreshRoutes, { listings, sources, scraperRuns, queues })
  await app.register(adminRepeatableRoutes, {
    db,
    sources,
    queues,
    ...(jobRunReaper ? { jobRunReaper } : {}),
  })
}
