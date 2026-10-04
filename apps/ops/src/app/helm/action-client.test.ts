// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  enqueueSearchRebuild, enqueueSourceRun, enqueueSourceStage, fetchQueueJob, setProblemAcknowledged,
} from './action-client'

function respond(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function stubFetch(response: Response | Error) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (response instanceof Error) throw response
    return response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('enqueue contracts', () => {
  it('run source posts to the source run endpoint and reads data.id', async () => {
    const fetchMock = stubFetch(respond(201, { data: { id: 'job-7' } }))
    const result = await enqueueSourceRun('/api/bff', 'src 1')
    expect(result).toEqual({ ok: true, value: { queue: 'source-scrape', jobId: 'job-7' } })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/bff/admin/sources/src%201/run')
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
  })

  it('keeps the API error code and message for a disabled source (409)', async () => {
    stubFetch(respond(409, { error: { code: 'SOURCE_DISABLED', message: 'Source "BLVD" is paused and cannot be run' } }))
    expect(await enqueueSourceRun('/api/bff', 's1')).toEqual({
      ok: false, status: 409, code: 'SOURCE_DISABLED', message: 'Source "BLVD" is paused and cannot be run',
    })
  })

  it('detail stage enqueue sends the selected source id in data.sourceId', async () => {
    const fetchMock = stubFetch(respond(201, { data: { id: '55' } }))
    const result = await enqueueSourceStage('/api/bff', 'detail-crawl', 's1')
    expect(result).toEqual({ ok: true, value: { queue: 'detail-crawl', jobId: '55' } })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/bff/admin/queues/detail-crawl/jobs')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ data: { sourceId: 's1' } })
  })

  it('search rebuild reads data.jobId (not data.id) and requires enqueued: true', async () => {
    stubFetch(respond(202, { data: { enqueued: true, jobId: 'listing-sync-rebuild' } }))
    expect(await enqueueSearchRebuild('/api/bff')).toEqual({ ok: true, value: { queue: 'listing-sync', jobId: 'listing-sync-rebuild' } })
    stubFetch(respond(202, { data: { id: 'x' } }))
    expect(await enqueueSearchRebuild('/api/bff')).toMatchObject({ ok: false, code: 'UNEXPECTED_RESPONSE' })
  })

  it('reports a rate limit as a real enqueue failure', async () => {
    stubFetch(respond(429, { error: { code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded' } }))
    expect(await enqueueSearchRebuild('/api/bff')).toMatchObject({ ok: false, status: 429, code: 'TOO_MANY_REQUESTS' })
  })

  it('treats a success response with no job id as a failure rather than something to track', async () => {
    stubFetch(respond(201, { data: {} }))
    expect(await enqueueSourceRun('/api/bff', 's1')).toMatchObject({ ok: false, code: 'UNEXPECTED_RESPONSE' })
  })

  it('reports network errors without a status', async () => {
    stubFetch(new TypeError('Failed to fetch'))
    expect(await enqueueSourceStage('/api/bff', 'detail-extract', 's1')).toEqual({ ok: false, status: null, code: null, message: 'Failed to fetch' })
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json') } }) as unknown as Response))
    expect(await enqueueSourceRun('/api/bff', 's1')).toMatchObject({ ok: false, status: 502, message: 'API returned 502' })
  })
})

describe('acknowledge contract', () => {
  it('posts fingerprint and acknowledged and surfaces a 404', async () => {
    const fetchMock = stubFetch(respond(404, { error: { code: 'NOT_FOUND', message: 'Problem fingerprint not found' } }))
    expect(await setProblemAcknowledged('/api/bff', 'fp', true)).toMatchObject({ ok: false, status: 404 })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ fingerprint: 'fp', acknowledged: true })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/bff/internal/ops/problem-ack')
  })
})

describe('fetchQueueJob', () => {
  const queueBody = (jobs: unknown[]) => respond(200, { data: { name: 'q', jobs } })

  it('maps BullMQ states to tracked statuses', async () => {
    stubFetch(queueBody([{ id: '9', status: 'delayed', createdAt: '2026-10-04T10:00:00Z' }]))
    expect(await fetchQueueJob('/api/bff', 'q', '9')).toMatchObject({ ok: true, value: { job: { status: 'queued' } } })
    stubFetch(queueBody([{ id: '9', status: 'failed', failedReason: 'boom', finishedAt: '2026-10-04T10:01:00Z' }]))
    expect(await fetchQueueJob('/api/bff', 'q', '9')).toMatchObject({ value: { job: { status: 'failed', failedReason: 'boom' } } })
  })

  it('returns job: null (not a terminal state) when the job is not in the list', async () => {
    stubFetch(queueBody([{ id: '1', status: 'completed' }]))
    expect(await fetchQueueJob('/api/bff', 'q', '9')).toEqual({ ok: true, value: { job: null } })
  })

  it('maps not-yet-started BullMQ states to queued', async () => {
    for (const status of ['prioritized', 'paused', 'waiting-children']) {
      stubFetch(queueBody([{ id: '9', status }]))
      expect(await fetchQueueJob('/api/bff', 'q', '9')).toMatchObject({ ok: true, value: { job: { status: 'queued' } } })
    }
  })

  it('an unknown job state is an explicit failure, not a missing job', async () => {
    stubFetch(queueBody([{ id: '9', status: 'mystery' }]))
    expect(await fetchQueueJob('/api/bff', 'q', '9')).toMatchObject({ ok: false, code: 'UNSUPPORTED_JOB_STATE' })
  })

  it('fails when the queue body has no jobs array', async () => {
    stubFetch(respond(200, { data: {} }))
    expect(await fetchQueueJob('/api/bff', 'q', '9')).toMatchObject({ ok: false, code: 'UNEXPECTED_RESPONSE' })
  })
})
