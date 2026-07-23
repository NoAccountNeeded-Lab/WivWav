import type { FastifyPluginAsync } from 'fastify'
import type { SentryIssueSummary } from '@wivwav/types'

interface AdminSentryIssuesPluginOptions {
  /** Read-only Sentry API auth token/org/project (`SENTRY_ISSUES_*` env
   *  vars). Deliberately distinct from apps/web's `SENTRY_AUTH_TOKEN` /
   *  `SENTRY_ORG` / `SENTRY_PROJECT`, which are build-time-only credentials
   *  scoped to source-map upload — this is a separate, narrower-scoped
   *  server-side read token and must not reuse that value. */
  sentryAuthToken: string | undefined
  sentryOrg: string | undefined
  sentryProject: string | undefined
}

/** Shape of one entry from Sentry's issues API:
 *  `GET /api/0/projects/{org}/{project}/issues/`. Only the fields this
 *  route consumes are declared. */
interface SentryApiIssue {
  id: string
  title: string
  culprit: string | null
  level: string
  count: string
  firstSeen: string
  lastSeen: string
  permalink: string
}

/**
 * GET /admin/sentry/issues
 *
 * Read-only proxy for recent unresolved Sentry issue summaries (issue #890,
 * federated into the problem aggregate downstream). Never throws: missing
 * credentials, an unreachable Sentry API, or a non-2xx response all return
 * `{ data: { issues: [], unavailable: true } }` rather than a non-2xx
 * response, mirroring `signalAvailability` in `attention-snapshot.ts`.
 */
export const adminSentryIssuesRoutes: FastifyPluginAsync<AdminSentryIssuesPluginOptions> = async (
  app,
  { sentryAuthToken, sentryOrg, sentryProject },
) => {
  app.get('/', async (_req, reply) => {
    if (!sentryAuthToken || !sentryOrg || !sentryProject) {
      return reply.send({ data: { issues: [], unavailable: true } })
    }

    const params = new URLSearchParams({ query: 'is:unresolved', statsPeriod: '24h', sort: 'freq' })
    let res: Response
    try {
      res = await fetch(`https://sentry.io/api/0/projects/${sentryOrg}/${sentryProject}/issues/?${params.toString()}`, {
        signal: AbortSignal.timeout(8_000),
        headers: { Authorization: `Bearer ${sentryAuthToken}` },
      })
    } catch {
      return reply.send({ data: { issues: [], unavailable: true } })
    }

    if (!res.ok) {
      return reply.send({ data: { issues: [], unavailable: true } })
    }

    let body: unknown
    try {
      body = await res.json()
    } catch {
      return reply.send({ data: { issues: [], unavailable: true } })
    }

    if (!Array.isArray(body)) {
      return reply.send({ data: { issues: [], unavailable: true } })
    }

    const issues: SentryIssueSummary[] = (body as SentryApiIssue[]).map(toIssueSummary)
    return reply.send({ data: { issues, unavailable: false } })
  })
}

function toIssueSummary(issue: SentryApiIssue): SentryIssueSummary {
  return {
    id: issue.id,
    title: issue.title,
    culprit: issue.culprit ?? null,
    level: issue.level,
    count: Number(issue.count),
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    permalink: issue.permalink,
  }
}
