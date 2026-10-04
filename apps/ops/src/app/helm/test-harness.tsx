// Shared test scaffolding for the /helm workspace tests: a stateful
// `next/navigation` stand-in and a mutable fake API "world" served through
// `fetch` at the same `/api/bff/*` paths the UI calls in production.
import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import type { HelmSummary, ProblemAggregateResponse } from '@wivwav/types'
import type { PipelineStage } from '../ops/sources/[id]/source-pipeline-helpers'
import type { QueueRow, RunRow, ScheduleEntry, SourceRow } from '../ops/overview-helpers'
import { aggregate, problem, run, source, stage, summary } from './fixtures'

// ── navigation ──────────────────────────────────────────────────────────

const urlListeners = new Set<() => void>()
let search = ''

export function setUrl(query: string) {
  search = query.startsWith('?') ? query.slice(1) : query
  urlListeners.forEach(listener => listener())
}

export function currentSearch(): string {
  return search
}

function applyHref(href: string) {
  const index = href.indexOf('?')
  setUrl(index === -1 ? '' : href.slice(index))
}

export const router = {
  push: vi.fn((href: string) => applyHref(href)),
  replace: vi.fn((href: string) => applyHref(href)),
}

export const navigationMock = {
  usePathname: () => '/helm',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(
    listener => { urlListeners.add(listener); return () => urlListeners.delete(listener) },
    () => search,
    () => search,
  )),
}

// ── fake API ────────────────────────────────────────────────────────────

export interface World {
  health: unknown
  queues: QueueRow[] | 'fail'
  sources: SourceRow[] | 'fail'
  runs: RunRow[] | 'fail'
  schedules: ScheduleEntry[]
  aggregate: ProblemAggregateResponse | 'fail'
  summary: HelmSummary | 'fail'
  pipeline: PipelineStage[]
  runTree: unknown[]
  logs: unknown[] | 'fail'
  /** POST handlers keyed by `METHOD path`, returning a status + body. */
  posts: Record<string, () => { status: number; body: unknown }>
  /** Jobs per queue name for GET /admin/queues/:name. */
  jobs: Record<string, unknown[]>
  calls: { method: string; path: string; body: unknown }[]
}

export function defaultWorld(): World {
  return {
    health: { status: 'ok', timestamp: new Date().toISOString(), services: { postgres: { status: 'up' }, meilisearch: { status: 'up' }, valkey: { status: 'up' }, ollama: { status: 'up' }, scraper: { status: 'up' } } },
    queues: [
      { name: 'source-scrape', paused: false, stats: { waiting: 0, active: 0, completed: 10, failed: 1, delayed: 0 } },
      { name: 'detail-crawl', paused: false, stats: { waiting: 7, active: 1, completed: 40, failed: 0, delayed: 0 } },
      { name: 'detail-extract', paused: false, stats: { waiting: 2, active: 0, completed: 40, failed: 0, delayed: 0 } },
    ],
    sources: [source({ status: 'error', errorMessage: 'selector missing' }), source({ id: 's2', name: 'Paused Co', status: 'paused' })],
    runs: [run({ id: 'r1', success: false, errorMessage: 'selector missing', startedAt: '2026-10-04T09:00:00Z', finishedAt: '2026-10-04T09:01:00Z' })],
    schedules: [],
    aggregate: aggregate([problem()]),
    summary: summary(),
    pipeline: [stage({ stage: 'detail-crawl', queue: 'detail-crawl', failedCount: 0 })],
    runTree: [],
    logs: [],
    posts: {},
    jobs: {},
    calls: [],
  }
}

function reply(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

export function installFetch(world: World) {
  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost')
    const path = url.pathname.replace(/^\/api\/bff/, '')
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) as unknown : null
    world.calls.push({ method, path, body })
    const fail = reply(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'down' } })
    const data = (value: unknown) => (value === 'fail' ? fail : reply(200, { data: value }))

    if (method === 'POST') {
      if (path === '/internal/ops/problem-aggregate') return data(world.aggregate)
      const custom = world.posts[`POST ${path}`]
      if (custom) {
        const result = custom()
        return reply(result.status, result.body)
      }
      return reply(404, { error: { code: 'NOT_FOUND', message: `No fake for POST ${path}` } })
    }
    if (path === '/health') return data(world.health)
    if (path === '/admin/queues') return data(world.queues)
    if (path === '/admin/sources') return data(world.sources)
    if (path === '/admin/runs') return data(world.runs)
    if (path === '/admin/repeatables') return data(world.schedules)
    if (path === '/admin/listing-refresh/status') return reply(200, { data: { generatedAt: new Date().toISOString(), sources: {}, listings: { missingLocations: 0 }, latestScrapeRun: null, queues: [] } })
    if (path === '/internal/ops/helm-summary') return data(world.summary)
    if (path === '/admin/logs') return world.logs === 'fail' ? reply(503, { error: { code: 'LOG_BACKEND_UNAVAILABLE', message: 'Loki down' } }) : reply(200, { data: { entries: world.logs, services: [] } })
    const pipeline = /^\/admin\/sources\/([^/]+)\/pipeline$/.exec(path)
    if (pipeline) return data({ source: { id: decodeURIComponent(pipeline[1] ?? ''), name: 'BLVD' }, generatedAt: new Date().toISOString(), stages: world.pipeline })
    const tree = /^\/admin\/sources\/([^/]+)\/job-runs$/.exec(path)
    if (tree) return data({ source: { id: decodeURIComponent(tree[1] ?? ''), name: 'BLVD' }, generatedAt: new Date().toISOString(), runs: world.runTree })
    const queue = /^\/admin\/queues\/([^/]+)$/.exec(path)
    if (queue) return data({ name: queue[1], jobs: world.jobs[decodeURIComponent(queue[1] ?? '')] ?? [] })
    return reply(404, { error: { code: 'NOT_FOUND', message: `No fake for GET ${path}` } })
  }
  const fn = vi.fn(handler)
  vi.stubGlobal('fetch', fn)
  return fn
}

export function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}
