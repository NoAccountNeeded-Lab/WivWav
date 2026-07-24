import type { FastifyPluginAsync } from 'fastify'
import type { AttentionResourceInput, AttentionSnapshotRequest, Problem, ProblemState } from '@wivwav/types'
import { computeProblemAggregate } from '../domain/problem-aggregate.js'
import { fetchGrafanaAlerts, type GrafanaAlertsClientOptions } from '../services/grafana-alerts-client.js'
import { fetchSentryIssues, type SentryIssuesClientOptions } from '../services/sentry-issues-client.js'
import type { OpsProblemStateRepository, OpsProblemStateRow } from '../repositories/index.js'

const RESOURCE_KEYS = ['health', 'queues', 'sources', 'runs', 'schedules'] as const

interface InternalOpsProblemAggregatePluginOptions extends GrafanaAlertsClientOptions, SentryIssuesClientOptions {
  problemStates: OpsProblemStateRepository
}

/**
 * POST /internal/ops/problem-aggregate
 *
 * The single server-side call the ops overview's Attention panel and
 * `/ops/problems` both render from (issue #892, child of #758) — neither
 * consumer may fork this computation into a second implementation. A new
 * privileged operator API, so it mounts under `/internal/ops/*` alongside
 * `internal-ops-problem-ack` (#891), not under `/admin/*` (see `app.ts`).
 *
 * Same "caller reports already-fetched domain resource state" pattern as
 * `POST /admin/attention-snapshot` (E5: independent per-section
 * streaming/retry) for `health`/`queues`/`sources`/`runs`/`schedules`. Unlike
 * that route, Grafana and Sentry state is fetched here server-side rather
 * than posted by the browser — `internal-grafana-alerts`/`internal-sentry-issues`
 * are internal server-to-server surfaces the ops browser client never calls
 * directly (see `app.ts`), so this route reuses the same fetch clients they
 * do instead of round-tripping through them or duplicating their logic.
 *
 * After federating (`computeProblemAggregate`, issue #890), every problem is
 * persisted via `problemStates.recordPass` and the returned rows are merged
 * back in as `ProblemState`, so `firstSeen`/`lastSeen`/`occurrenceCount`/
 * acknowledgement are populated for every problem — including domain
 * conditions, which `computeProblemAggregate` itself always reports with
 * `firstSeen`/`lastSeen`/`occurrenceCount` null since it recomputes them
 * fresh on every call with no history of its own.
 */
export const internalOpsProblemAggregateRoutes: FastifyPluginAsync<InternalOpsProblemAggregatePluginOptions> = async (
  app,
  { problemStates, grafanaUrl, grafanaApiToken, sentryAuthToken, sentryOrg, sentryProject },
) => {
  app.post<{ Body: unknown }>('/', async (req, reply) => {
    const body = req.body

    if (!isRecord(body) || typeof body.now !== 'string') {
      return reply.badRequest('Request body must include a "now" ISO timestamp string')
    }

    for (const key of RESOURCE_KEYS) {
      if (!isResourceInput(body[key])) {
        return reply.badRequest(`Request body must include a "${key}" resource with { data, unavailable }`)
      }
    }

    const [grafana, sentry] = await Promise.all([
      fetchGrafanaAlerts({ grafanaUrl, grafanaApiToken }),
      fetchSentryIssues({ sentryAuthToken, sentryOrg, sentryProject }),
    ])

    const aggregate = computeProblemAggregate({
      domain: body as unknown as AttentionSnapshotRequest,
      grafana: { data: grafana.alerts, unavailable: grafana.unavailable },
      sentry: { data: sentry.issues, unavailable: sentry.unavailable },
    })

    const now = new Date(body.now)
    const rows = await problemStates.recordPass(
      aggregate.problems.map(problem => ({ fingerprint: problem.fingerprint, source: problem.source })),
      now,
    )
    const rowsByFingerprint = new Map(rows.map(row => [row.fingerprint, row]))

    const problems: ProblemState[] = aggregate.problems.map(problem => mergeProblemState(problem, rowsByFingerprint.get(problem.fingerprint)))

    return reply.send({ data: { problems, availability: aggregate.availability } })
  })
}

function mergeProblemState(problem: Problem, row: OpsProblemStateRow | undefined): ProblemState {
  return {
    ...problem,
    firstSeen: row ? row.firstSeenAt.toISOString() : problem.firstSeen,
    lastSeen: row ? row.lastSeenAt.toISOString() : problem.lastSeen,
    occurrenceCount: row ? row.occurrenceCount : problem.occurrenceCount,
    acknowledgedAt: row?.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    acknowledgedBy: row?.acknowledgedBy ?? null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isResourceInput(value: unknown): value is AttentionResourceInput<unknown> {
  return isRecord(value) && 'data' in value && typeof value.unavailable === 'boolean'
}
