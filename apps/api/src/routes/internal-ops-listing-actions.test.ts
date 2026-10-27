import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { describe, expect, it, vi } from 'vitest'
import { MockQueueFactory, QUEUES } from '@wivwav/queue'
import type { MockQueueAdapter } from '@wivwav/queue'
import { adminAuthPlugin } from '../plugins/admin-auth.js'
import { internalOpsListingActionsRoutes } from './internal-ops-listing-actions.js'

const SECRET = 'a'.repeat(32)
const auth = { authorization: `Bearer ${SECRET}` }

type Row = Record<string, unknown>
const base: Row = { id: 'l1', status: 'active', publicationStatus: 'eligible', manuallyHiddenAt: null, vin: '1FTBW2CM5NKA12345', sourceId: 'src-1' }

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v instanceof Date) return row[k] instanceof Date && row[k].getTime() === v.getTime()
    if (v !== null && typeof v === 'object') {
      const cond = v as { not?: unknown }
      return cond.not === null ? row[k] !== null : row[k] !== cond.not
    }
    return row[k] === v
  })
}

async function buildApp(row: Row | null, opts: { beforeUpdate?: () => void; failEnqueue?: boolean } = {}) {
  const factory = new MockQueueFactory()
  const resolveQ = factory.createQueue(QUEUES.LISTING_RESOLVE) as MockQueueAdapter
  if (opts.failEnqueue) resolveQ.add = vi.fn(async () => { throw new Error('redis down') })
  const audits: Row[] = []
  const tx = {
    listing: {
      // Snapshot read: a concurrent writer can change the live row before the update.
      findUnique: vi.fn(async () => (row ? { ...row } : null)),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        opts.beforeUpdate?.()
        if (!row || !matches(row, where)) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      }),
    },
    listingObservation: { create: vi.fn(async ({ data }: { data: Row }) => { audits.push(data); return {} }) },
  }
  const db = { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) }
  const app = Fastify()
  await app.register(sensible)
  await app.register(
    async (scope) => {
      await adminAuthPlugin(scope, { internalApiSecret: SECRET, nodeEnv: 'test' })
      await scope.register(internalOpsListingActionsRoutes, { db: db as never, queueFactory: factory })
    },
    { prefix: '/internal/ops/listings' },
  )
  await app.ready()
  const post = (id: string, payload: unknown, headers: Record<string, string> = auth) =>
    app.inject({ method: 'POST', url: `/internal/ops/listings/${id}/actions`, headers: { 'content-type': 'application/json', ...headers }, payload: JSON.stringify(payload) })
  const vinQ = factory.createQueue(QUEUES.VIN_ENRICH) as MockQueueAdapter
  const detailQ = factory.createQueue(QUEUES.DETAIL_CRAWL) as MockQueueAdapter
  return { app, post, audits, resolveQ, vinQ, detailQ }
}

describe('POST /internal/ops/listings/:id/actions', () => {
  it('requires the bearer', async () => {
    const { app, post } = await buildApp({ ...base })
    expect((await post('l1', { action: 'hide' }, {})).statusCode).toBe(401)
    await app.close()
  })

  it('404s an unknown listing', async () => {
    const { app, post, audits } = await buildApp(null)
    expect((await post('nope', { action: 'mark-gone' })).statusCode).toBe(404)
    expect(audits).toHaveLength(0)
    await app.close()
  })

  it('400s malformed bodies instead of throwing', async () => {
    const { app, post } = await buildApp({ ...base })
    for (const payload of [[], 'x', { action: 5 }, { action: 'explode' }, { action: 'requeue-everything' },
      { action: 'hide', reason: 7 }, { action: 'hide', reason: '  ' }, { action: 'hide', reason: 'x'.repeat(501) }]) {
      expect((await post('l1', payload)).statusCode).toBe(400)
    }
    await app.close()
  })

  it('requeue-resolve returns a fresh job id every time and audits each', async () => {
    const { app, post, audits } = await buildApp({ ...base })
    const a = await post('l1', { action: 'requeue-resolve' })
    const b = await post('l1', { action: 'requeue-resolve' })
    expect(a.statusCode).toBe(200)
    expect(a.json().data.jobId).toBeTruthy()
    expect(b.json().data.jobId).not.toBe(a.json().data.jobId)
    expect(audits).toHaveLength(2)
    expect(audits[0]).toMatchObject({ stage: 'ops_action', after: { action: 'requeue-resolve', result: 'applied' } })
    await app.close()
  })

  it('requeue-vin-decode enqueues a listing-scoped vin-enrich job and audits it', async () => {
    const { app, post, audits, vinQ } = await buildApp({ ...base })
    const res = await post('l1', { action: 'requeue-vin-decode' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.jobId).toBeTruthy()
    expect(vinQ.getEnqueued()[0]).toMatchObject({ data: { listingId: 'l1' } })
    expect(audits[0]).toMatchObject({ after: { action: 'requeue-vin-decode', result: 'applied' } })
    await app.close()
  })

  it('requeue-vin-decode refuses a listing without a VIN or a gone listing', async () => {
    const noVin = await buildApp({ ...base, vin: null })
    expect((await noVin.post('l1', { action: 'requeue-vin-decode' })).statusCode).toBe(409)
    expect(noVin.vinQ.getEnqueued()).toHaveLength(0)
    await noVin.app.close()
    const gone = await buildApp({ ...base, status: 'gone' })
    expect((await gone.post('l1', { action: 'requeue-vin-decode' })).statusCode).toBe(409)
    await gone.app.close()
  })

  it('requeue-detail enqueues a listing-scoped detail-crawl job for the listing source', async () => {
    const { app, post, detailQ } = await buildApp({ ...base })
    const res = await post('l1', { action: 'requeue-detail' })
    expect(res.statusCode).toBe(200)
    expect(detailQ.getEnqueued()[0]).toMatchObject({ data: { sourceId: 'src-1', listingId: 'l1' } })
    await app.close()
  })

  it('requeue-detail refuses a gone listing', async () => {
    const { app, post, detailQ } = await buildApp({ ...base, status: 'gone' })
    expect((await post('l1', { action: 'requeue-detail' })).statusCode).toBe(409)
    expect(detailQ.getEnqueued()).toHaveLength(0)
    await app.close()
  })

  it('hide suppresses, is idempotent, blocks resolve, and unhide restores with a resolve job', async () => {
    const row = { ...base }
    const { app, post, resolveQ } = await buildApp(row)
    expect((await post('l1', { action: 'hide', reason: 'bad data' })).json().data.changed).toBe(true)
    expect(row).toMatchObject({ publicationStatus: 'quarantined', manualHideReason: 'bad data' })
    expect((await post('l1', { action: 'hide', reason: 'again' })).json().data.changed).toBe(false)
    expect((await post('l1', { action: 'requeue-resolve' })).statusCode).toBe(409)
    expect((await post('l1', { action: 'release-quarantine' })).statusCode).toBe(409)
    expect((await post('l1', { action: 'unhide', manuallyHiddenAt: (row.manuallyHiddenAt as Date).toISOString() })).json().data.jobId).toBeTruthy()
    expect(row).toMatchObject({ manuallyHiddenAt: null, publicationStatus: 'pending' })
    expect(resolveQ.getEnqueued()).toHaveLength(1)
    await app.close()
  })

  it('unhide with a stale timestamp conflicts and leaves the newer hide in place; missing or invalid is 400', async () => {
    const row: Row = { ...base, manuallyHiddenAt: new Date('2026-10-02T00:00:00.000Z'), publicationStatus: 'quarantined' }
    const { app, post, resolveQ } = await buildApp(row)
    const stale = await post('l1', { action: 'unhide', manuallyHiddenAt: '2026-10-01T00:00:00.000Z' })
    expect(stale.statusCode).toBe(409)
    expect(row.manuallyHiddenAt).toEqual(new Date('2026-10-02T00:00:00.000Z'))
    expect(resolveQ.getEnqueued()).toHaveLength(0)
    for (const payload of [{ action: 'unhide' }, { action: 'unhide', manuallyHiddenAt: 'nope' }, { action: 'unhide', manuallyHiddenAt: 5 }]) {
      expect((await post('l1', payload)).statusCode).toBe(400)
    }
    const ok = await post('l1', { action: 'unhide', manuallyHiddenAt: '2026-10-02T00:00:00.000Z' })
    expect(ok.json().data.changed).toBe(true)
    expect(row.manuallyHiddenAt).toBeNull()
    await app.close()
  })

  it('a hide landing between read and update is not overwritten by release-quarantine or unhide semantics', async () => {
    const row: Row = { ...base, publicationStatus: 'quarantined' }
    const { app, post, resolveQ } = await buildApp(row, {
      beforeUpdate: () => { row.manuallyHiddenAt = new Date() },
    })
    const res = await post('l1', { action: 'release-quarantine' })
    expect(res.statusCode).toBe(409)
    expect(row.publicationStatus).toBe('quarantined')
    expect(resolveQ.getEnqueued()).toHaveLength(0)
    await app.close()
  })

  it('mark-gone is idempotent and a concurrent gone is a no-op', async () => {
    const row = { ...base }
    const { app, post } = await buildApp(row)
    expect((await post('l1', { action: 'mark-gone' })).json().data.changed).toBe(true)
    expect(row.status).toBe('gone')
    expect((await post('l1', { action: 'mark-gone' })).json().data.changed).toBe(false)
    expect((await post('l1', { action: 'requeue-resolve' })).statusCode).toBe(409)
    await app.close()
  })

  it('release-quarantine needs a quarantined listing, audits the refusal, then queues resolve', async () => {
    const row = { ...base }
    const { app, post, audits } = await buildApp(row)
    expect((await post('l1', { action: 'release-quarantine' })).statusCode).toBe(409)
    expect(audits.at(-1)).toMatchObject({ after: { result: 'conflict' } })
    row.publicationStatus = 'quarantined'
    const res = await post('l1', { action: 'release-quarantine' })
    expect(res.json().data.jobId).toBeTruthy()
    expect(row.publicationStatus).toBe('pending')
    await app.close()
  })

  it('records a failed enqueue and reports 502', async () => {
    const row: Row = { ...base, publicationStatus: 'quarantined' }
    const { app, post, audits } = await buildApp(row, { failEnqueue: true })
    const res = await post('l1', { action: 'release-quarantine' })
    expect(res.statusCode).toBe(502)
    expect(audits.at(-1)).toMatchObject({ after: { result: 'enqueue_failed', detail: 'redis down' } })
    await app.close()
  })
})
