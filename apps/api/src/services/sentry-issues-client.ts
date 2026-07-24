import type { SentryIssueSummary } from '@wivwav/types'

export interface SentryIssuesClientOptions {
  /** Read-only Sentry API auth token/org/project (`SENTRY_ISSUES_*` env
   *  vars). Deliberately distinct from apps/web's `SENTRY_AUTH_TOKEN` /
   *  `SENTRY_ORG` / `SENTRY_PROJECT`, which are build-time-only credentials
   *  scoped to source-map upload — this is a separate, narrower-scoped
   *  server-side read token and must not reuse that value. */
  sentryAuthToken: string | undefined
  sentryOrg: string | undefined
  sentryProject: string | undefined
}

export interface SentryIssuesFetchResult {
  issues: SentryIssueSummary[]
  unavailable: boolean
}

/** Shape of one entry from Sentry's issues API:
 *  `GET /api/0/projects/{org}/{project}/issues/`. Only the fields this
 *  client consumes are declared. */
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
 * Read-only fetch of recent unresolved Sentry issue summaries (issue #890,
 * federated into the problem aggregate downstream). Never throws: missing
 * credentials, an unreachable Sentry API, or a non-2xx response all return
 * `{ issues: [], unavailable: true }` rather than rejecting.
 *
 * Shared by `routes/internal-sentry-issues.ts` (the server-to-server proxy)
 * and `routes/internal-ops-problem-aggregate.ts` (issue #892, which needs the same
 * data server-side rather than round-tripping through that internal route)
 * so the two never fork the Sentry-to-`SentryIssueSummary` mapping.
 */
export async function fetchSentryIssues({ sentryAuthToken, sentryOrg, sentryProject }: SentryIssuesClientOptions): Promise<SentryIssuesFetchResult> {
  if (!sentryAuthToken || !sentryOrg || !sentryProject) {
    return { issues: [], unavailable: true }
  }

  const params = new URLSearchParams({ query: 'is:unresolved', statsPeriod: '24h', sort: 'freq' })
  let res: Response
  try {
    res = await fetch(`https://sentry.io/api/0/projects/${sentryOrg}/${sentryProject}/issues/?${params.toString()}`, {
      signal: AbortSignal.timeout(8_000),
      headers: { Authorization: `Bearer ${sentryAuthToken}` },
    })
  } catch {
    return { issues: [], unavailable: true }
  }

  if (!res.ok) {
    return { issues: [], unavailable: true }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { issues: [], unavailable: true }
  }

  if (!Array.isArray(body)) {
    return { issues: [], unavailable: true }
  }

  return { issues: (body as SentryApiIssue[]).map(toIssueSummary), unavailable: false }
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
