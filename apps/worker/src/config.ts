import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'

/**
 * Generic worker runtime configuration (#952). Deliberately minimal: a
 * worker never touches Postgres, Meilisearch, or valkey, so its env surface
 * is just enough to dial the coordinator and describe its own capacity.
 */
export interface WorkerConfig {
  /** Coordinator base URL, e.g. `http://api:3001`. */
  coordinatorUrl: string
  /** Bearer token — matches the coordinator's `INTERNAL_API_SECRET`. */
  workerToken: string
  /** Stable id surviving reconnects; defaults to `<hostname>-<random>`. */
  workerId: string
  /** Human-readable name for logs/ops UI; defaults to the hostname. */
  workerName: string
  capabilities: {
    chromium: boolean
    httpEnrich: boolean
    maxConcurrentJobs: number
  }
}

function parseFlag(pairs: string[], key: string, fallback: boolean): boolean {
  const entry = pairs.find((pair) => pair.startsWith(`${key}=`))
  return entry ? entry.split('=')[1]?.trim().toLowerCase() === 'true' : fallback
}

function parseCapabilities(raw: string | undefined): { chromium: boolean; httpEnrich: boolean } {
  // Format: comma-separated key=value pairs, e.g. "chromium=true,httpEnrich=false".
  // Unknown keys are ignored — this is deliberately forward-compatible with
  // future capability flags this worker binary predates. Both flags default
  // to true: a worker with no WORKER_CAPABILITIES override advertises every
  // capability this binary understands, exactly as `chromium` alone did
  // before #962 added `httpEnrich` as a second, independent dimension.
  const pairs = (raw ?? '').split(',').map((pair) => pair.trim())
  return {
    chromium: parseFlag(pairs, 'chromium', true),
    httpEnrich: parseFlag(pairs, 'httpEnrich', true),
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim().length === 0) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const coordinatorUrl = env['COORDINATOR_URL']
  if (!coordinatorUrl || coordinatorUrl.trim().length === 0) {
    throw new Error('COORDINATOR_URL is required')
  }
  const workerToken = env['WORKER_TOKEN']
  if (!workerToken || workerToken.trim().length === 0) {
    throw new Error('WORKER_TOKEN is required')
  }

  const { chromium, httpEnrich } = parseCapabilities(env['WORKER_CAPABILITIES'])
  const maxConcurrentJobs = parsePositiveInt(env['WORKER_MAX_CONCURRENT_JOBS'], 2)

  return {
    coordinatorUrl: coordinatorUrl.replace(/\/+$/, ''),
    workerToken,
    workerId: env['WORKER_ID'] ?? `${hostname()}-${randomUUID().slice(0, 8)}`,
    workerName: env['WORKER_NAME'] ?? hostname(),
    capabilities: { chromium, httpEnrich, maxConcurrentJobs },
  }
}
