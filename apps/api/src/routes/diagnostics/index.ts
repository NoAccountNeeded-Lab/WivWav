import type { FastifyPluginAsync } from 'fastify'
import type { CacheService } from '../../services/cache/index.js'
import type { Meilisearch } from 'meilisearch'
import type { PrismaClient } from '@wivwav/db'
import type { QueueFactory } from '@wivwav/queue'
import type { Config } from '../../config.js'
import type { SourceRepository, ScraperRunRepository } from '../../repositories/index.js'
import { diagnosticContextRoutes } from './context.js'
import { systemSnapshotRoutes } from './system-snapshot.js'
import { correlationRoutes } from './correlation.js'

export interface DiagnosticsPluginOptions {
  db: PrismaClient
  sources: SourceRepository
  scraperRuns: ScraperRunRepository
  meili: Meilisearch
  cache: CacheService
  queueFactory: QueueFactory
  config: Config
}

/**
 * The three read-only AI diagnostic gateway routes ratified in #757 (Q1, Q2,
 * Q7) and built on top of the `/diagnostics` fail-closed auth boundary
 * (#773) and the shared domain snapshot (#774). `get_source_pipeline`,
 * `get_recent_logs`, and `get_failed_job` remain out of scope here — they
 * are bounded/typed wrappers over existing `/admin` routes exposed later
 * through the MCP adapter (follow-up issue), not new API routes.
 */
export const diagnosticsRoutes: FastifyPluginAsync<DiagnosticsPluginOptions> = async (
  app,
  { db, sources, scraperRuns, meili, cache, queueFactory, config },
) => {
  await app.register(diagnosticContextRoutes, {
    prefix: '/diagnostic-context',
    gitSha: config.GIT_SHA,
    nodeEnv: config.NODE_ENV,
  })

  await app.register(systemSnapshotRoutes, {
    prefix: '/system-snapshot',
    db,
    sources,
    scraperRuns,
    meili,
    cache,
    config,
    internalApiSecret: config.INTERNAL_API_SECRET,
  })

  await app.register(correlationRoutes, {
    prefix: '/correlation',
    sources,
    scraperRuns,
    queueFactory,
    lokiUrl: config.LOKI_URL,
  })
}
