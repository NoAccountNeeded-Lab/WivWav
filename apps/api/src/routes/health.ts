import { ConfigService } from '../services/config-service.js'
import type { FastifyPluginAsync } from 'fastify'
import type { CacheService } from '../services/cache/index.js'
import type { Meilisearch } from 'meilisearch'
import type { PrismaClient } from '@wivwav/db'
import type { HealthResponse, OverallHealthStatus, ServiceHealth } from '@wivwav/types'
import type { Config } from '../config.js'
import type { SourceRepository, ScraperRunRepository } from '../repositories/index.js'

const LATENCY_SETTING_KEYS = {
  postgres: 'health.latency_ms.postgres',
  meilisearch: 'health.latency_ms.meilisearch',
  valkey: 'health.latency_ms.valkey',
  ollama: 'health.latency_ms.ollama',
} as const

const LATENCY_THRESHOLDS_MS = {
  postgres: 100,
  meilisearch: 150,
  valkey: 100,
  ollama: 750,
} as const

const PROBE_TIMEOUT_MS = 1500

interface HealthPluginOptions {
  db: PrismaClient
  sources: SourceRepository
  scraperRuns: ScraperRunRepository
  meili: Meilisearch
  cache: CacheService
  config: Config
}

type ProbeName = keyof typeof LATENCY_THRESHOLDS_MS

export const healthRoutes: FastifyPluginAsync<HealthPluginOptions> = async (app, opts) => {
  app.get('/', { logLevel: 'silent' }, async (): Promise<HealthResponse> => computeHealth(opts))
}

/**
 * The same all-service health probe `GET /health` runs, factored out so the
 * diagnostic gateway's `get_system_snapshot` (#775, `routes/diagnostics/system-snapshot.ts`)
 * can obtain a `HealthResponse` directly instead of forking this probing
 * logic into a second implementation.
 */
export async function computeHealth({ db, sources, scraperRuns, meili, cache, config }: HealthPluginOptions): Promise<HealthResponse> {
  const operatorConfig = new ConfigService(db, cache, config.CONFIG_ENCRYPTION_SECRET)
  const [postgresThreshold, meilisearchThreshold, valkeyThreshold, ollamaThreshold] = await Promise.all([
    operatorConfig.getOperatorSetting(LATENCY_SETTING_KEYS.postgres),
    operatorConfig.getOperatorSetting(LATENCY_SETTING_KEYS.meilisearch),
    operatorConfig.getOperatorSetting(LATENCY_SETTING_KEYS.valkey),
    operatorConfig.getOperatorSetting(LATENCY_SETTING_KEYS.ollama),
  ])
  const [postgres, meilisearch, valkey, ollama, scraper] = await Promise.all([
    probe('postgres', () => db.$queryRaw`SELECT 1`, postgresThreshold),
    probe('meilisearch', () => meili.health(), meilisearchThreshold),
    probe('valkey', () => cache.ping(), valkeyThreshold),
    probeOllama(config, ollamaThreshold),
    getScraperHealth(sources, scraperRuns, operatorConfig),
  ])

  const services = { postgres, meilisearch, valkey, ollama, scraper }

  return {
    status: getOverallStatus(Object.values(services)),
    timestamp: new Date().toISOString(),
    services,
  }
}

async function probeOllama(config: Config, threshold: number): Promise<ServiceHealth> {
  const health = await probe('ollama', async () => {
    const response = await fetch(`${config.OLLAMA_BASE_URL}/`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`)
  }, threshold)

  if (health.status !== 'down') return health
  if (config.OLLAMA_REQUIRED) return { ...health, message: 'Required local AI service is unreachable' }

  return {
    status: 'optional_offline',
    message: 'Optional AI remapping is offline; scraping continues without AI assistance',
  }
}

async function probe(name: ProbeName, fn: () => Promise<unknown>, threshold: number = LATENCY_THRESHOLDS_MS[name]): Promise<ServiceHealth> {
  const started = performance.now()

  try {
    await withTimeout(fn(), PROBE_TIMEOUT_MS)
    const latencyMs = Math.round(performance.now() - started)
    return {
      status: latencyMs > threshold ? 'degraded' : 'up',
      latencyMs,
    }
  } catch (err) {
    return { status: 'down', message: err instanceof Error ? err.message : 'Service did not respond' }
  }
}

async function getScraperHealth(sources: SourceRepository, scraperRuns: ScraperRunRepository, operatorConfig: ConfigService): Promise<ServiceHealth> {
  try {
    const [sourceCount, activeSourceCount, lastRun] = await withTimeout(
      Promise.all([
        sources.count(),
        sources.countActive(),
        scraperRuns.findLastSuccessful(),
      ]),
      PROBE_TIMEOUT_MS
    )

    if (sourceCount === 0) return { status: 'degraded', message: 'No sources are configured' }
    if (activeSourceCount === 0) return {
      status: 'degraded',
      message: `All ${sourceCount} source${sourceCount !== 1 ? 's' : ''} are inactive — check source errors`,
    }
    if (!lastRun || !lastRun.finishedAt) return { status: 'up', message: 'No completed scraper run on record yet' }

    const finishedAt = lastRun.finishedAt
    const lastRunAt = finishedAt.toISOString()
    const ageMs = Date.now() - finishedAt.getTime()
    const staleHours = await operatorConfig.getOperatorSetting('health.scraper_stale_hours')
    const stale = ageMs > staleHours * 60 * 60 * 1000
    return {
      status: stale ? 'degraded' : 'up',
      lastRunAt,
      ...(stale ? { message: `Last successful scrape was ${Math.round(ageMs / 3_600_000)}h ago` } : {}),
    }
  } catch (err) {
    return { status: 'down', message: err instanceof Error ? err.message : 'Scraper health check failed' }
  }
}

function getOverallStatus(services: ServiceHealth[]): OverallHealthStatus {
  if (services.some(service => service.status === 'down')) return 'down'
  if (services.some(service => service.status === 'degraded')) return 'degraded'
  return 'ok'
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Health probe timed out')), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
