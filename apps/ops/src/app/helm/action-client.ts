import { fetchWithTimeout } from '@/lib/fetch-with-timeout'

/**
 * Exact request/response contracts for the /helm recovery actions (issue
 * #1071), all through the authenticated `/api/bff` proxy:
 *
 *   POST /admin/sources/:id/run           201 { data: { id } }      409 SOURCE_DISABLED
 *   POST /admin/queues/:name/jobs         201 { data: { id } }      400 missing data.sourceId
 *        body { data: { sourceId } }      (detail-crawl / detail-extract are source-scoped)
 *   POST /admin/sync                      202 { data: { enqueued, jobId } }   429 rate limit
 *   POST /internal/ops/problem-ack        200 { data: row }         404 unknown fingerprint
 *   GET  /admin/queues/:name              200 { data: { jobs: [...] } }
 *
 * Unlike `fetchJson` this keeps the HTTP status and the API's
 * `{ error: { code, message } }` so the UI can say *why* an enqueue failed.
 */

export type ActionFailure = { ok: false; status: number | null; code: string | null; message: string }
export type ActionResult<T> = { ok: true; value: T } | ActionFailure

export const SOURCE_SCRAPE_QUEUE = 'source-scrape'
export const LISTING_SYNC_QUEUE = 'listing-sync'
export type SourceStageQueue = 'detail-crawl' | 'detail-extract'

export interface EnqueuedJob {
  queue: string
  jobId: string
}

const ACTION_TIMEOUT_MS = 15_000

async function request(url: string, init: RequestInit): Promise<{ ok: true; body: unknown } | ActionFailure> {
  let res: Response
  try {
    res = await fetchWithTimeout(url, { cache: 'no-store', ...init }, ACTION_TIMEOUT_MS)
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    return { ok: false, status: null, code: null, message: aborted ? 'The request timed out' : err instanceof Error ? err.message : 'Request failed' }
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null
    const code = error && typeof error['code'] === 'string' ? error['code'] : null
    const message = error && typeof error['message'] === 'string' ? error['message'] : `API returned ${res.status}`
    return { ok: false, status: res.status, code, message }
  }
  return { ok: true, body }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function dataOf(body: unknown): Record<string, unknown> | null {
  return isRecord(body) && isRecord(body['data']) ? body['data'] : null
}

function malformed(what: string): ActionFailure {
  return { ok: false, status: null, code: 'UNEXPECTED_RESPONSE', message: `${what} returned an unexpected response, so no job could be tracked` }
}

function jsonPost(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

function takeJobId(data: Record<string, unknown> | null, field: string): string | null {
  const value = data?.[field]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export async function enqueueSourceRun(apiBaseUrl: string, sourceId: string): Promise<ActionResult<EnqueuedJob>> {
  const result = await request(`${apiBaseUrl}/admin/sources/${encodeURIComponent(sourceId)}/run`, { method: 'POST' })
  if (!result.ok) return result
  const jobId = takeJobId(dataOf(result.body), 'id')
  return jobId ? { ok: true, value: { queue: SOURCE_SCRAPE_QUEUE, jobId } } : malformed('Run source')
}

export async function enqueueSourceStage(apiBaseUrl: string, queue: SourceStageQueue, sourceId: string): Promise<ActionResult<EnqueuedJob>> {
  const result = await request(`${apiBaseUrl}/admin/queues/${encodeURIComponent(queue)}/jobs`, jsonPost({ data: { sourceId } }))
  if (!result.ok) return result
  const jobId = takeJobId(dataOf(result.body), 'id')
  return jobId ? { ok: true, value: { queue, jobId } } : malformed(`Enqueue ${queue}`)
}

export async function enqueueSearchRebuild(apiBaseUrl: string): Promise<ActionResult<EnqueuedJob>> {
  const result = await request(`${apiBaseUrl}/admin/sync`, { method: 'POST' })
  if (!result.ok) return result
  const data = dataOf(result.body)
  const jobId = takeJobId(data, 'jobId')
  if (!jobId || data?.['enqueued'] !== true) return malformed('Search rebuild')
  return { ok: true, value: { queue: LISTING_SYNC_QUEUE, jobId } }
}

export async function setProblemAcknowledged(
  apiBaseUrl: string,
  fingerprint: string,
  acknowledged: boolean,
): Promise<ActionResult<{ acknowledgedAt: string | null; acknowledgedBy: string | null }>> {
  const result = await request(`${apiBaseUrl}/internal/ops/problem-ack`, jsonPost({ fingerprint, acknowledged }))
  if (!result.ok) return result
  const data = dataOf(result.body)
  if (!data) return malformed('Acknowledge')
  return {
    ok: true,
    value: {
      acknowledgedAt: typeof data['acknowledgedAt'] === 'string' ? data['acknowledgedAt'] : null,
      acknowledgedBy: typeof data['acknowledgedBy'] === 'string' ? data['acknowledgedBy'] : null,
    },
  }
}

export type TrackedJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface JobSnapshot {
  id: string
  status: TrackedJobStatus
  /** Server timestamps (ISO); finishedAt only once the job is terminal. */
  createdAt: string | null
  finishedAt: string | null
  failedReason: string | null
}

function mapJobStatus(status: unknown): TrackedJobStatus | null {
  switch (status) {
    // BullMQ states beyond the adapter's declared union that are all "not started yet".
    case 'waiting':
    case 'delayed':
    case 'prioritized':
    case 'paused':
    case 'waiting-children':
      return 'queued'
    case 'active':
      return 'running'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    default:
      return null
  }
}

/**
 * Looks one job up in `GET /admin/queues/:name`. `{ job: null }` means the
 * queue answered but the job is not in its retained list (removed or aged
 * out) — callers must treat that as *unavailable*, never as done. A job in a
 * state this client does not know is an `UNSUPPORTED_JOB_STATE` failure, not
 * a missing job.
 */
export async function fetchQueueJob(apiBaseUrl: string, queue: string, jobId: string): Promise<ActionResult<{ job: JobSnapshot | null }>> {
  const result = await request(`${apiBaseUrl}/admin/queues/${encodeURIComponent(queue)}`, { method: 'GET' })
  if (!result.ok) return result
  const jobs = dataOf(result.body)?.['jobs']
  if (!Array.isArray(jobs)) return malformed(`Queue ${queue}`)
  for (const raw of jobs) {
    if (!isRecord(raw) || String(raw['id']) !== jobId) continue
    const status = mapJobStatus(raw['status'])
    if (!status) {
      return {
        ok: false,
        status: null,
        code: 'UNSUPPORTED_JOB_STATE',
        message: `Job ${jobId} is in an unrecognised queue state (${typeof raw['status'] === 'string' ? raw['status'] : 'missing'}), so its outcome cannot be determined`,
      }
    }
    return {
      ok: true,
      value: {
        job: {
          id: jobId,
          status,
          createdAt: typeof raw['createdAt'] === 'string' ? raw['createdAt'] : null,
          finishedAt: typeof raw['finishedAt'] === 'string' ? raw['finishedAt'] : null,
          failedReason: typeof raw['failedReason'] === 'string' ? raw['failedReason'] : null,
        },
      },
    }
  }
  return { ok: true, value: { job: null } }
}
