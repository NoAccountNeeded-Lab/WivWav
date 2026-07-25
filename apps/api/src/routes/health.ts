import type { FastifyPluginAsync } from 'fastify'
import type { CacheService } from '../services/cache/index.js'
import type { Meilisearch } from 'meilisearch'
import type { PrismaClient } from '@wivwav/db'
import type { HealthResponse, OverallHealthStatus, ServiceHealth } from '@wivwav/types'
import type { Config } from '../config.js'
import type { SourceRepository, ScraperRunRepository } from '../repositories/index.js'

const LATENCY_THRESHOLDS_MS = {
  postgres: 100,
  meilisearch: 150,
  valkey: 100,
  ollama: 750,
} as const

const SCRAPER_STALE_MS = 24 * 60 * 60 * 1000
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
  const [postgres, meilisearch, valkey, ollama, scraper] = await Promise.all([
    probe('postgres', () => db.$queryRaw`SELECT 1`),
    probe('meilisearch', () => meili.health()),
    probe('valkey', () => cache.ping()),
    probeOllama(config),
    getScraperHealth(sources, scraperRuns),
  ])

  const services = { postgres, meilisearch, valkey, ollama, scraper }

  return {
    status: getOverallStatus(Object.values(services)),
    timestamp: new Date().toISOString(),
    services,
  }
}

async function probeOllama(config: Config): Promise<ServiceHealth> {
  const health = await probe('ollama', async () => {
    const response = await fetch(`${config.OLLAMA_BASE_URL}/`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`)
  })

  if (health.status !== 'down') return health
  if (config.OLLAMA_REQUIRED) return { ...health, message: 'Required local AI service is unreachable' }

  return {
    status: 'optional_offline',
    message: 'Optional AI remapping is offline; scraping continues without AI assistance',
  }
}

async function probe(name: ProbeName, fn: () => Promise<unknown>): Promise<ServiceHealth> {
  const started = performance.now()

  try {
    await withTimeout(fn(), PROBE_TIMEOUT_MS)
    const latencyMs = Math.round(performance.now() - started)
    return {
      status: latencyMs > LATENCY_THRESHOLDS_MS[name] ? 'degraded' : 'up',
      latencyMs,
    }
  } catch (err) {
    return { status: 'down', message: err instanceof Error ? err.message : 'Service did not respond' }
  }
}

async function getScraperHealth(sources: SourceRepository, scraperRuns: ScraperRunRepository): Promise<ServiceHealth> {
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
    const stale = ageMs > SCRAPER_STALE_MS
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
