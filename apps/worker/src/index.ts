import 'dotenv/config'
import { createLogger } from '@wivwav/logger'
import { PlaywrightBrowserService } from '@wivwav/scraper-sources/browser/playwright-browser-service.js'
import { loadWorkerConfig } from './config.js'
import { HttpClient } from './http-client.js'
import { ScraperGatewayClient } from './scraper-gateway-client.js'
import { HandlerRegistry } from './handler-registry.js'
import { WsClient } from './ws-client.js'
import { createSourceScrapeHandler } from './handlers/source-scrape.js'
import { createDetailCrawlHandler } from './handlers/detail-crawl.js'
import { createDetailExtractHandler } from './handlers/detail-extract.js'

const config = loadWorkerConfig()
const logger = createLogger({
  service: 'worker',
  env: process.env['NODE_ENV'] ?? 'development',
})

const httpClient = new HttpClient({
  baseUrl: config.coordinatorUrl,
  token: config.workerToken,
  logger,
})
const gateway = new ScraperGatewayClient(httpClient)

// One shared Chromium instance/process for every dispatched job — mirrors
// apps/scraper's single browserService, and keeps the worker's own
// WORKER_MAX_CONCURRENT_JOBS the only concurrency knob that matters.
const browserService = new PlaywrightBrowserService()

// Queue name literals mirror @wivwav/queue's QUEUES.{SOURCE_SCRAPE,DETAIL_CRAWL,
// DETAIL_EXTRACT} (packages/queue/src/queues.ts) — not imported directly so
// this app never depends on @wivwav/queue (which pulls in bullmq/ioredis;
// the worker never talks to valkey, see #952's acceptance criteria).
const handlers = new HandlerRegistry()
handlers.register('source-scrape', createSourceScrapeHandler(gateway, browserService, logger))
handlers.register('detail-crawl', createDetailCrawlHandler(gateway, browserService, logger))
handlers.register('detail-extract', createDetailExtractHandler(gateway, browserService, logger))

const wsClient = new WsClient({
  coordinatorUrl: config.coordinatorUrl,
  token: config.workerToken,
  workerId: config.workerId,
  workerName: config.workerName,
  capabilities: config.capabilities,
  handlers,
  gateway,
  logger,
})

logger.info(
  {
    event: 'worker.starting',
    workerId: config.workerId,
    workerName: config.workerName,
    capabilities: config.capabilities,
    coordinatorUrl: config.coordinatorUrl,
  },
  '[worker] starting',
)

wsClient.start()

async function shutdown(signal: string): Promise<void> {
  logger.info({ event: 'worker.shutdown', signal }, `[worker] received ${signal}; shutting down`)
  wsClient.stop()
  process.exit(0)
}

process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))
