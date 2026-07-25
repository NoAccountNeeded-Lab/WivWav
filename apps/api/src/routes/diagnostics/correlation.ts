import type { FastifyPluginAsync } from 'fastify'
import type { JobRecord, QueueFactory } from '@wivwav/queue'
import { QUEUES } from '@wivwav/queue'
import type { SourceRepository, ScraperRunRepository } from '../../repositories/index.js'
import { queryLokiRange, type LogEntry } from '../../services/loki-client.js'
import { resolveWindow } from './window.js'

const ALLOWED_ID_TYPES = ['jobId', 'sourceId', 'requestId'] as const
type IdType = (typeof ALLOWED_ID_TYPES)[number]

const MAX_LOG_LINES = 100
const MAX_RUNS = 50
/** Loki's `|=` filter only matches substrings, so more lines than the final
 *  100-line cap must be fetched before the exact-field re-check in
 *  `matchesIdField` narrows them down — otherwise a handful of unrelated
 *  substring matches at the head of the result could crowd out real matches
 *  before re-filtering ever sees them. Mirrors `admin-logs.ts`'s own max. */
const LOKI_FETCH_LIMIT = 500

export interface CorrelationPluginOptions {
  sources: SourceRepository
  scraperRuns: ScraperRunRepository
  queueFactory: QueueFactory
  lokiUrl: string
}

interface QuerystringShape {
  idType?: string
  id?: string
  windowMinutes?: string
}

/**
 * GET /diagnostics/correlation?idType=<jobId|sourceId|requestId>&id=<value>&windowMinutes=<n> (#775, Q7 from #757)
 *
 * Joins logs/jobs/runs/source state by an allow-listed `idType` — the MVP
 * set ratified in #757 (`jobId`, `sourceId`, `requestId`). Any other
 * `idType` is rejected with 400 rather than accepted and silently ignored,
 * since this route deliberately does not accept arbitrary query fields.
 * Log lines are capped at 100 with a `truncated` marker when more matched;
 * `windowMinutes` follows the same ≤24h/default-1h bound as
 * `get_system_snapshot`.
 */
export const correlationRoutes: FastifyPluginAsync<CorrelationPluginOptions> = async (
  app,
  { sources, scraperRuns, queueFactory, lokiUrl },
) => {
  const queues = new Map(Object.values(QUEUES).map((name) => [name, queueFactory.createQueue(name)]))

  app.get<{ Querystring: QuerystringShape }>('/', async (req, reply) => {
    const { idType, id } = req.query

    if (idType === undefined || !isAllowedIdType(idType)) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_ID_TYPE',
          message: `idType must be one of: ${ALLOWED_ID_TYPES.join(', ')}`,
        },
      })
    }
    if (id === undefined || id.trim().length === 0) {
      return reply.code(400).send({ error: { code: 'MISSING_ID', message: 'id is required' } })
    }

    const nowMs = Date.now()
    const window = resolveWindow(req.query.windowMinutes, nowMs)

    const entities = await gatherEntities(idType, id, { sources, scraperRuns, queues })
    if (entities === NOT_FOUND) {
      return reply.notFound(`No ${idType} "${id}" found`)
    }

    const logs = await correlateLogs(lokiUrl, idType, id, window)

    return reply.send({
      data: {
        idType,
        id,
        window: { minutes: window.minutes, since: window.since, until: window.until },
        entities,
        logs,
      },
    })
  })
}

function isAllowedIdType(value: string): value is IdType {
  return (ALLOWED_ID_TYPES as readonly string[]).includes(value)
}

const NOT_FOUND = Symbol('not-found')

interface GatherDeps {
  sources: SourceRepository
  scraperRuns: ScraperRunRepository
  queues: Map<string, ReturnType<QueueFactory['createQueue']>>
}

async function gatherEntities(idType: IdType, id: string, deps: GatherDeps): Promise<Record<string, unknown> | typeof NOT_FOUND> {
  if (idType === 'requestId') return {}

  if (idType === 'sourceId') {
    const source = await deps.sources.findById(id)
    if (!source) return NOT_FOUND

    const recentRuns = await deps.scraperRuns.findRecent(200)
    const runs = recentRuns.filter((run) => run.sourceId === id).slice(0, MAX_RUNS)

    return {
      source: { id: source.id, name: source.name, status: source.status, lastScrapedAt: source.lastScrapedAt },
      runs,
    }
  }

  // idType === 'jobId'
  let match: { queue: string; job: JobRecord } | null = null
  for (const [name, queue] of deps.queues) {
    const jobs = await queue.getJobs(['waiting', 'active', 'completed', 'failed', 'delayed'])
    const job = jobs.find((candidate) => candidate.id === id)
    if (job) {
      match = { queue: name, job }
      break
    }
  }

  return {
    job: match
      ? {
          queue: match.queue,
          id: match.job.id,
          name: match.job.name,
          status: match.job.status,
          createdAt: match.job.createdAt,
          finishedAt: match.job.finishedAt ?? null,
          attemptsMade: match.job.attemptsMade,
          failedReason: match.job.failedReason ?? null,
        }
      : null,
  }
}

interface CorrelationLogs {
  lines: LogEntry[]
  truncated: boolean
  unavailable: boolean
}

async function correlateLogs(lokiUrl: string, idType: IdType, id: string, window: ReturnType<typeof resolveWindow>): Promise<CorrelationLogs> {
  // Substring line filter: jobId/sourceId/requestId are embedded in the
  // pino-JSON log body (see services/loki-client.ts's parseLine), not a Loki
  // stream label, so a LogQL line filter is the correct match strategy here
  // (same approach `admin-logs.ts`'s `search` param uses).
  const safeId = id.replace(/`/g, '')
  const logql = '{service=~".+"} |= `' + safeId + '`'

  const result = await queryLokiRange(lokiUrl, {
    logql,
    startMs: window.sinceMs,
    endMs: window.untilMs,
    limit: LOKI_FETCH_LIMIT,
  })

  if (!result.ok) {
    return { lines: [], truncated: false, unavailable: true }
  }

  const matched = result.entries.filter((entry) => matchesIdField(entry, idType, id))
  return {
    lines: matched.slice(0, MAX_LOG_LINES),
    truncated: matched.length > MAX_LOG_LINES,
    unavailable: false,
  }
}

/** Loki's `|=` filter matches anywhere in the line, so double-check the
 *  parsed field itself before treating an entry as correlated — otherwise a
 *  jobId that happens to be a substring of an unrelated message would
 *  false-positive. */
function matchesIdField(entry: LogEntry, idType: IdType, id: string): boolean {
  if (idType === 'jobId') return entry.jobId === id
  if (idType === 'sourceId') return entry.sourceId === id
  return entry.requestId === id
}
