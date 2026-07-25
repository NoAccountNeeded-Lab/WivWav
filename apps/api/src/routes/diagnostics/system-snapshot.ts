import type { FastifyPluginAsync } from 'fastify'
import type { CacheService } from '../../services/cache/index.js'
import type { Meilisearch } from 'meilisearch'
import type { PrismaClient } from '@wivwav/db'
import type {
  AttentionQueueSignal,
  AttentionResourceInput,
  AttentionRunSignal,
  AttentionScheduleSignal,
  AttentionSnapshot,
  AttentionSnapshotRequest,
  AttentionSourceSignal,
} from '@wivwav/types'
import type { Config } from '../../config.js'
import type { SourceRepository, ScraperRunRepository } from '../../repositories/index.js'
import { computeHealth } from '../health.js'
import { computeAttentionSnapshot } from '../../domain/attention-snapshot.js'
import { pingLoki } from '../../services/loki-client.js'
import { isRecord, pickBoolean, pickNumber, pickString, pickStringRequired } from './safe-pick.js'
import { resolveWindow } from './window.js'

const MAX_SOURCES = 200
const MAX_QUEUES = 50
const MAX_RUNS = 100
const MAX_SCHEDULES = 100

export interface SystemSnapshotPluginOptions {
  db: PrismaClient
  sources: SourceRepository
  scraperRuns: ScraperRunRepository
  meili: Meilisearch
  cache: CacheService
  config: Config
  /** Sent as `Authorization: Bearer <secret>` on the in-process `/admin/*`
   *  calls below, mirroring `adminAuthPlugin`'s own accepted credential.
   *  `undefined` in local dev, where `/admin/*` is unauthenticated. */
  internalApiSecret: string | undefined
}

interface QuerystringShape {
  windowMinutes?: string
}

/**
 * GET /diagnostics/system-snapshot?windowMinutes=<n> (#775, Q2/Q7 from #757)
 *
 * Serves the #774 domain computation (`computeAttentionSnapshot`) windowed
 * to `windowMinutes` (default 60, capped at 1440/24h) with per-section item
 * caps. Queue/source/run/schedule state is gathered by calling the already-
 * registered `/admin/queues`, `/admin/sources`, `/admin/runs`, and
 * `/admin/repeatables` routes in-process via `app.inject` — those routes
 * (particularly `/admin/repeatables`, which reconciles canonical schedule
 * definitions against live BullMQ state) are the single source of truth for
 * this data; this route must not fork a second implementation of that
 * reconciliation. Health uses `computeHealth` directly (the same probe
 * `GET /health` runs) since that has no reconciliation logic to fork.
 * `signalAvailability.loki` reflects a real reachability probe
 * (`pingLoki`), unlike every other `computeAttentionSnapshot` caller, which
 * never populates it (see `domain/attention-snapshot.ts`).
 */
export const systemSnapshotRoutes: FastifyPluginAsync<SystemSnapshotPluginOptions> = async (
  app,
  { db, sources, scraperRuns, meili, cache, config, internalApiSecret },
) => {
  app.get<{ Querystring: QuerystringShape }>('/', async (req, reply) => {
    const nowMs = Date.now()
    const window = resolveWindow(req.query.windowMinutes, nowMs)

    const authHeaders = internalApiSecret ? { authorization: `Bearer ${internalApiSecret}` } : {}

    const [healthResult, queuesRes, sourcesRes, runsRes, schedulesRes, lokiReachable] = await Promise.all([
      computeHealth({ db, sources, scraperRuns, meili, cache, config }).then(
        (data) => ({ ok: true as const, data }),
        () => ({ ok: false as const }),
      ),
      app.inject({ method: 'GET', url: '/admin/queues', headers: authHeaders }),
      app.inject({ method: 'GET', url: '/admin/sources', headers: authHeaders }),
      app.inject({ method: 'GET', url: '/admin/runs', headers: authHeaders }),
      app.inject({ method: 'GET', url: '/admin/repeatables', headers: authHeaders }),
      pingLoki(config.LOKI_URL),
    ])

    const queues = extractDataArray(queuesRes.statusCode, queuesRes.json())
    const sourcesData = extractDataArray(sourcesRes.statusCode, sourcesRes.json())
    const runsData = extractDataArray(runsRes.statusCode, runsRes.json())
    const schedulesData = extractDataArray(schedulesRes.statusCode, schedulesRes.json())

    const queueSignals = queues?.map(mapQueue).slice(0, MAX_QUEUES) ?? null
    const sourceSignals = sourcesData?.map(mapSource).slice(0, MAX_SOURCES) ?? null
    const runsInWindow = runsData
      ?.map(mapRun)
      .filter((run) => run.finishedAt === null || Date.parse(run.finishedAt) >= window.sinceMs)
      ?? null
    const runSignals = runsInWindow?.slice(0, MAX_RUNS) ?? null
    const scheduleSignals = schedulesData?.map(mapSchedule).slice(0, MAX_SCHEDULES) ?? null

    const request: AttentionSnapshotRequest = {
      now: new Date(nowMs).toISOString(),
      health: healthResult.ok
        ? { data: healthResult.data, unavailable: false }
        : { data: null, unavailable: true },
      queues: resourceInput(queueSignals, queuesRes.statusCode),
      sources: resourceInput(sourceSignals, sourcesRes.statusCode),
      runs: resourceInput(runSignals, runsRes.statusCode),
      schedules: resourceInput(scheduleSignals, schedulesRes.statusCode),
      loki: { data: null, unavailable: !lokiReachable },
    }

    const snapshot: AttentionSnapshot = computeAttentionSnapshot(request)

    return reply.send({
      data: {
        snapshot,
        window: { minutes: window.minutes, since: window.since, until: window.until },
        counts: {
          queues: queueSignals?.length ?? 0,
          sources: sourceSignals?.length ?? 0,
          runs: runSignals?.length ?? 0,
          schedules: scheduleSignals?.length ?? 0,
        },
        truncated: {
          sources: (sourcesData?.length ?? 0) > MAX_SOURCES,
          runs: (runsInWindow?.length ?? 0) > MAX_RUNS,
          schedules: (schedulesData?.length ?? 0) > MAX_SCHEDULES,
        },
      },
    })
  })
}

function resourceInput<T>(data: T[] | null, statusCode: number): AttentionResourceInput<T[]> {
  return { data, unavailable: statusCode !== 200 }
}

function extractDataArray(statusCode: number, body: unknown): Record<string, unknown>[] | null {
  if (statusCode !== 200 || !isRecord(body) || !Array.isArray(body.data)) return null
  return body.data.filter(isRecord)
}

function mapQueue(row: Record<string, unknown>): AttentionQueueSignal {
  const stats = isRecord(row.stats) ? row.stats : {}
  return {
    name: pickStringRequired(row.name),
    paused: pickBoolean(row.paused),
    stats: {
      waiting: pickNumber(stats.waiting),
      active: pickNumber(stats.active),
      completed: pickNumber(stats.completed),
      failed: pickNumber(stats.failed),
      delayed: pickNumber(stats.delayed),
    },
  }
}

function mapSource(row: Record<string, unknown>): AttentionSourceSignal {
  return {
    id: pickStringRequired(row.id),
    name: pickStringRequired(row.name),
    status: pickStringRequired(row.status),
    errorMessage: pickString(row.errorMessage),
    listingCount: pickNumber(row.listingCount),
    possiblyGoneCount: pickNumber(row.possiblyGoneCount),
  }
}

function mapRun(row: Record<string, unknown>): AttentionRunSignal {
  return {
    id: pickStringRequired(row.id),
    sourceId: pickStringRequired(row.sourceId),
    finishedAt: pickString(row.finishedAt),
    success: typeof row.success === 'boolean' ? row.success : null,
  }
}

function mapSchedule(row: Record<string, unknown>): AttentionScheduleSignal {
  return {
    id: pickStringRequired(row.id),
    label: pickStringRequired(row.label),
    enabled: pickBoolean(row.enabled),
    recentFailureCount: pickNumber(row.recentFailureCount),
  }
}
