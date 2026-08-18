import 'dotenv/config'
import { createLogger } from '@wivwav/logger'
import { PlaywrightBrowserService } from '@wivwav/scraper-sources/browser/playwright-browser-service.js'
import { loadWorkerConfig } from './config.js'
import { HttpClient } from './http-client.js'
import { ScraperGatewayClient } from './scraper-gateway-client.js'
import { HttpEnrichGatewayClient } from './http-enrich-gateway-client.js'
import { HandlerRegistry } from './handler-registry.js'
import { WsClient } from './ws-client.js'
import { createSourceScrapeHandler } from './handlers/source-scrape.js'
import { createDetailCrawlHandler } from './handlers/detail-crawl.js'
import { createDetailExtractHandler } from './handlers/detail-extract.js'
import { createNhtsaRecallsHandler } from './handlers/nhtsa-recalls.js'
import { createNhtsaComplaintsHandler } from './handlers/nhtsa-complaints.js'
import { createNhtsaSafetyRatingsHandler } from './handlers/nhtsa-safety-ratings.js'
import { createNhtsaInvestigationsHandler } from './handlers/nhtsa-investigations.js'
import { createNhtsaManufacturerCommunicationsHandler } from './handlers/nhtsa-manufacturer-communications.js'
import { createVinEnrichHandler } from './handlers/vin-enrich.js'
import { createModelResearchHandler } from './handlers/model-research.js'
import { createFuelEconomyMsrpHandler } from './handlers/fueleconomy-msrp.js'
import { createDealerEnrichHandler } from './handlers/dealer-enrich.js'

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
const httpEnrichGateway = new HttpEnrichGatewayClient(httpClient)

// One shared Chromium instance/process for every dispatched job — mirrors
// apps/scraper's single browserService, and keeps the worker's own
// WORKER_MAX_CONCURRENT_JOBS the only concurrency knob that matters.
const browserService = new PlaywrightBrowserService()

// Queue name literals mirror @wivwav/queue's QUEUES.{SOURCE_SCRAPE,DETAIL_CRAWL,
// DETAIL_EXTRACT,...} (packages/queue/src/queues.ts) — not imported directly so
// this app never depends on @wivwav/queue (which pulls in bullmq/ioredis;
// the worker never talks to valkey, see #952's acceptance criteria).
const handlers = new HandlerRegistry()
handlers.register('source-scrape', createSourceScrapeHandler(gateway, browserService, logger))
handlers.register('detail-crawl', createDetailCrawlHandler(gateway, browserService, logger))
handlers.register('detail-extract', createDetailExtractHandler(gateway, browserService, logger))

// The 9 outbound-HTTP-only enrichment jobs (#963) — no Chromium/DOM
// dependency, dispatched under the worker's `httpEnrich` capability lane
// (see config.ts / worker-protocol.ts's workerCapabilitiesSchema).
handlers.register('nhtsa-recalls', createNhtsaRecallsHandler(httpEnrichGateway, logger))
handlers.register('nhtsa-complaints', createNhtsaComplaintsHandler(httpEnrichGateway, logger))
handlers.register('nhtsa-safety-ratings', createNhtsaSafetyRatingsHandler(httpEnrichGateway, logger))
handlers.register('nhtsa-investigations', createNhtsaInvestigationsHandler(httpEnrichGateway, logger))
handlers.register(
  'nhtsa-manufacturer-communications',
  createNhtsaManufacturerCommunicationsHandler(httpEnrichGateway, logger),
)
handlers.register('vin-enrich', createVinEnrichHandler(httpEnrichGateway, logger))
handlers.register('model-research', createModelResearchHandler(httpEnrichGateway, logger))
handlers.register('fueleconomy-msrp', createFuelEconomyMsrpHandler(httpEnrichGateway, logger))
handlers.register('dealer-enrich', createDealerEnrichHandler(httpEnrichGateway, logger))

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
