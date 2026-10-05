import { createHmac } from 'node:crypto'
import type { BrowserContext, Page, Route } from '@playwright/test'

/** Signed `ops_session` cookie value, same format as apps/ops/src/lib/session.ts. */
export function sessionCookieValue(): string {
  const secret = process.env['OPS_SESSION_SECRET']
    ?? (process.env['WIVWAV_HELM_E2E_URL'] ? 'dev-only-insecure-ops-session-secret' : 'e2e-helm-session-secret')
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 3_600_000 })).toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export async function signIn(context: BrowserContext, baseURL: string): Promise<void> {
  await context.addCookies([{ name: 'ops_session', value: sessionCookieValue(), url: baseURL }])
}

const SOURCE_PROBLEM = 'domain:source_error:source:s1'
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString()
const reading = (value: number | null) => ({ value, availability: value === null ? 'unavailable' : 'available', collectedAt: value === null ? null : iso() })

/** Mutable fake of the API behind `/api/bff`; tests move it through the failure → recovery story. */
export interface FakeApi {
  /** `POST /admin/sources/s1/run` outcome: a failure status, or accepted. */
  runBehaviour: 'reject' | 'accept'
  jobStatus: 'active' | 'completed'
  jobFinishedAtMs: number | null
  sourceHealthy: boolean
  problemReported: boolean
  freshRun: boolean
  dbSignalAvailable: boolean
  /** `GET /admin/queues`: the normal mixed set, or a 503 (unavailable). */
  queueData: 'mixed' | 'unavailable'
  calls: { method: string; path: string; body: unknown }[]
}

export function newFakeApi(): FakeApi {
  return { runBehaviour: 'reject', jobStatus: 'active', jobFinishedAtMs: null, sourceHealthy: false, problemReported: true, freshRun: false, dbSignalAvailable: true, queueData: 'mixed', calls: [] }
}

function problem() {
  return {
    fingerprint: SOURCE_PROBLEM, source: 'domain', severity: 'critical', detail: 'BLVD is in error', evidenceId: 'source:s1', href: null,
    firstSeen: iso(-3_600_000), lastSeen: iso(), occurrenceCount: 4, acknowledgedAt: null, acknowledgedBy: null,
  }
}

export function sourceRows(api: FakeApi) {
  return [
    { id: 's1', name: 'BLVD', status: api.sourceHealthy ? 'active' : 'error', lastScrapedAt: iso(-3_600_000), lastFullCrawlAt: null, lastObservedAt: null, listingCount: 120, errorMessage: api.sourceHealthy ? null : 'selector .price missing', possiblyGoneCount: 0 },
    { id: 's2', name: 'Paused Co', status: 'paused', lastScrapedAt: null, lastFullCrawlAt: null, lastObservedAt: null, listingCount: 5, errorMessage: null, possiblyGoneCount: 0 },
  ]
}

function runRows(api: FakeApi) {
  const failed = { id: 'r1', sourceId: 's1', sourceName: 'BLVD', startedAt: iso(-3_600_000), finishedAt: iso(-3_590_000), success: false, listingsFound: 0, listingsNew: 0, listingsUpdated: 0, errorMessage: 'selector .price missing' }
  // A second source with a mixed history so the per-source views have something to compare.
  const lakeside = [
    { id: 'l2', sourceId: 's3', sourceName: 'Lakeside', startedAt: iso(-1_800_000), finishedAt: iso(-1_790_000), success: true, listingsFound: 40, listingsNew: 1, listingsUpdated: 2, errorMessage: null },
    { id: 'l1', sourceId: 's3', sourceName: 'Lakeside', startedAt: iso(-7_200_000), finishedAt: iso(-7_190_000), success: true, listingsFound: 55, listingsNew: 3, listingsUpdated: 4, errorMessage: null },
  ]
  if (!api.freshRun) return [failed, ...lakeside]
  return [{ id: 'r2', sourceId: 's1', sourceName: 'BLVD', startedAt: iso(-2_000), finishedAt: iso(-1_000), success: true, listingsFound: 84, listingsNew: 2, listingsUpdated: 6, errorMessage: null }, failed, ...lakeside]
}

const SERVICES = { postgres: { status: 'up' }, meilisearch: { status: 'up' }, valkey: { status: 'up' }, ollama: { status: 'up' }, scraper: { status: 'up' } }

function respond(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function handle(api: FakeApi, route: Route) {
  const request = route.request()
  const url = new URL(request.url())
  const path = url.pathname.replace(/^\/api\/bff/, '')
  const method = request.method()
  const postData = request.postData()
  api.calls.push({ method, path, body: postData ? JSON.parse(postData) as unknown : null })
  const ok = (data: unknown) => respond(route, 200, { data })

  if (method === 'POST' && path === '/internal/ops/problem-aggregate') {
    return ok({
      problems: api.problemReported ? [problem()] : [],
      availability: { health: 'available', bullmq: 'available', db: api.dbSignalAvailable ? 'available' : 'unavailable', loki: 'available', grafana: 'available', sentry: 'available' },
    })
  }
  if (method === 'POST' && path === '/admin/sources/s1/run') {
    return api.runBehaviour === 'reject'
      ? respond(route, 503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'Queue service is unavailable' } })
      : respond(route, 201, { data: { id: '77' } })
  }
  if (method !== 'GET') return respond(route, 404, { error: { code: 'NOT_FOUND', message: `No fake for ${method} ${path}` } })

  if (path === '/health') return ok({ status: 'ok', timestamp: iso(), services: SERVICES })
  if (path === '/admin/queues') {
    if (api.queueData === 'unavailable') return respond(route, 503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'Queue service is unavailable' } })
    // Waiting + running work on two queues, one retry-style delayed job on detail-crawl, and 18 delayed-only queues outside the Helm stages.
    return ok([
      { name: 'source-scrape', paused: false, stats: { waiting: 0, active: api.jobStatus === 'active' ? 1 : 0, completed: 10, failed: 1, delayed: 0 } },
      { name: 'detail-crawl', paused: false, stats: { waiting: 7, active: 1, completed: 40, failed: 0, delayed: 1 } },
      { name: 'geocode', paused: false, stats: { waiting: 2, active: 0, completed: 12, failed: 0, delayed: 0 } },
      ...Array.from({ length: 18 }, (_, index) => ({ name: `reference-sync-${index + 1}`, paused: false, stats: { waiting: 0, active: 0, completed: 3, failed: 0, delayed: 1 } })),
    ])
  }
  if (path === '/admin/sources') return ok(sourceRows(api))
  if (path === '/admin/runs') return ok(runRows(api))
  if (path === '/admin/repeatables') return ok([])
  if (path === '/admin/listing-refresh/status') return ok({ generatedAt: iso(), sources: {}, listings: { missingLocations: 0 }, latestScrapeRun: null, queues: [] })
  if (path === '/internal/ops/helm-summary') {
    return ok({
      collectedAt: iso(), counts: { stored: reading(1200), active: reading(980), eligible: reading(910), indexed: reading(870) },
      availability: { database: 'available', search: 'available' },
    })
  }
  if (path === '/admin/queues/source-scrape') {
    return ok({ name: 'source-scrape', jobs: [{ id: '77', name: 'source-scrape', status: api.jobStatus, createdAt: iso(-8_000), ...(api.jobFinishedAtMs ? { finishedAt: new Date(api.jobFinishedAtMs).toISOString() } : {}) }] })
  }
  if (path === '/admin/sources/s1/pipeline') {
    return ok({ source: { id: 's1', name: 'BLVD' }, generatedAt: iso(), stages: [{ stage: 'source-scrape', queue: 'source-scrape', pendingCount: 0, lastCompletedAt: iso(-3_600_000), failedCount: api.sourceHealthy ? 0 : 1, failedScopedToSource: true, stalled: false, latestFailedJobId: null }] })
  }
  if (path === '/admin/sources/s1/job-runs') {
    return ok({ source: { id: 's1', name: 'BLVD' }, generatedAt: iso(), runs: [{ id: 'n1', jobType: 'source-scrape', sourceId: 's1', parentRunId: null, status: 'failed', startedAt: iso(-3_600_000), finishedAt: iso(-3_590_000), succeededCount: 0, failedCount: 1, errorMessage: 'selector .price missing', children: [] }] })
  }
  if (path === '/admin/logs') {
    return ok({ entries: [{ ts: iso(-3_595_000), level: 'error', service: 'worker', message: 'Selector .price missing for s1', requestId: 'req-1', queue: 'source-scrape', jobId: '70', sourceId: 's1', stack: 'Error: Selector .price missing\n    at scrape', extra: { attempt: 3 } }], services: ['worker'] })
  }
  return respond(route, 404, { error: { code: 'NOT_FOUND', message: `No fake for GET ${path}` } })
}

export async function installFakeApi(page: Page, api: FakeApi): Promise<void> {
  await page.route('**/api/bff/**', route => handle(api, route))
}
