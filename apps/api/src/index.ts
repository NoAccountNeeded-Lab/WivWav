import 'dotenv/config'
// Sentry is disabled by default. When explicitly enabled, this import must stay
// before app imports so startup errors can be captured.
import { isSentryEnabled, Sentry } from './sentry.js'

process.on('uncaughtException', (err) => {
  if (!isSentryEnabled) {
    process.exit(1)
  }

  Sentry.captureException(err)
  void Sentry.flush(2000).finally(() => process.exit(1))
})

import { Meilisearch } from 'meilisearch'
import { Redis } from 'ioredis'
import { RedisCacheService } from './services/cache/index.js'
import { getDb } from '@wivwav/db'
import { BullMQQueueFactory } from '@wivwav/queue'
import { loadConfig } from './config.js'
import { buildApp } from './app.js'
import { configureListingsIndex, ListingSearchService } from './services/listing-search.js'
import { ListingFacetsService } from './services/listing-facets.js'
import { MeilisearchService } from './services/search/index.js'
import { PrismaListingRepository } from './repositories/index.js'

const config = loadConfig()
if (!config.CONFIG_ENCRYPTION_SECRET) {
  console.error('CONFIG_ENCRYPTION_SECRET is required to start the API. Set it to a 64-character hex string (32 bytes).')
  process.exit(1)
}
const db = getDb()
const meili = new Meilisearch({ host: config.MEILISEARCH_HOST, apiKey: config.MEILISEARCH_API_KEY })
const redis = new Redis(config.VALKEY_URL, { lazyConnect: true, enableOfflineQueue: false })
const cache = new RedisCacheService(redis)
const searchService = new MeilisearchService(meili)
const search = new ListingSearchService(searchService)
const facets = new ListingFacetsService(searchService, cache)
const queueFactory = new BullMQQueueFactory()
const app = await buildApp(config, db, meili, cache, search, facets, queueFactory)

let shutdownPromise: Promise<void> | undefined

async function closeCache(): Promise<void> {
  if (redis.status === 'ready') {
    await redis.quit()
    return
  }

  redis.disconnect()
}

function shutdown(signal: NodeJS.Signals): Promise<void> {
  shutdownPromise ??= (async () => {
    app.log.info(`[shutdown] ${signal} received, closing`)

    try {
      await app.close()
      await queueFactory.close()
      await closeCache()
      await db.$disconnect()
      app.log.info('[shutdown] complete')
      if (isSentryEnabled) {
        await Sentry.flush(2000)
      }
      process.exit(0)
    } catch (err) {
      app.log.error(err, '[shutdown] failed')
      if (isSentryEnabled) {
        await Sentry.flush(2000)
      }
      process.exit(1)
    }
  })()

  return shutdownPromise
}

process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))

// Apply index settings before accepting traffic so filters/facets work on the
// first request. Idempotent — safe on every restart, including a fresh container.
try {
  await configureListingsIndex(meili)
  app.log.info('[search] Index settings applied')
} catch (err) {
  const reason = err instanceof Error ? `: ${err.message}` : ''
  app.log.warn(`[search] Index config skipped; Meilisearch may not be available${reason}`)
}

try {
  await app.listen({ port: config.PORT, host: config.HOST })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

// Initial sync runs in the background — can take minutes with many listings.
// Idempotent; safe to run on every restart.
void search.syncAll(new PrismaListingRepository(db))
  .then(n => app.log.info(`[search] Initial sync complete — ${n} listings indexed`))
  .catch(err => {
    const reason = err instanceof Error ? `: ${err.message}` : ''
    app.log.warn(`[search] Initial sync skipped; Meilisearch may not be available${reason}`)
  })
