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
const base: Row = {
  id: 'l1', status: 'active', publicationStatus: 'eligible', manuallyHiddenAt: null, vin: '1HGCM82633A004352', vehicleModelId: null,
}

async function buildApp(row: Row | null) {
  const factory = new MockQueueFactory()
  const db = {
    listing: {
      findUnique: vi.fn(async () => row),
      update: vi.fn(async ({ data }: { data: Row }) => { Object.assign(row ?? {}, data) }),
    },
    listingObservation: { create: vi.fn(async (_arg: { data: Row }) => ({})) },
  }
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
  const post = (id: string, payload: Row, headers = auth) =>
    app.inject({ method: 'POST', url: `/internal/ops/listings/${id}/actions`, headers, payload })
  const audit = () => db.listingObservation.create.mock.calls.map((c) => c[0].data)
  return { app, db, post, audit, resolveQ: factory.createQueue(QUEUES.LISTING_RESOLVE) as MockQueueAdapter }
}

describe('POST /internal/ops/listings/:id/actions', () => {
  it('requires the bearer', async () => {
    const { app, post } = await buildApp({ ...base })
    expect((await post('l1', { action: 'hide' }, {} as never)).statusCode).toBe(401)
    await app.close()
  })

  it('404s an unknown listing and 400s a bad action or a hide without reason', async () => {
    const { app, post } = await buildApp(null)
    expect((await post('nope', { action: 'mark-gone' })).statusCode).toBe(404)
    expect((await post('nope', { action: 'explode' })).statusCode).toBe(400)
    expect((await post('nope', { action: 'hide', reason: '  ' })).statusCode).toBe(400)
    await app.close()
  })

  it('requeue-resolve returns the queued job id and audits it', async () => {
    const { app, post, audit, resolveQ } = await buildApp({ ...base })
    const res = await post('l1', { action: 'requeue-resolve' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.jobId).toBe(resolveQ.getEnqueued()[0]!.id)
    expect(audit()).toHaveLength(1)
    expect(audit()[0]).toMatchObject({ stage: 'ops_action', after: { action: 'requeue-resolve', result: 'applied' } })
    await app.close()
  })

  it('hide suppresses, is idempotent, blocks resolve, and unhide restores with a resolve job', async () => {
    const row = { ...base }
    const { app, post, db, resolveQ } = await buildApp(row)
    const hide = await post('l1', { action: 'hide', reason: 'bad data' })
    expect(hide.json().data.changed).toBe(true)
    expect(row).toMatchObject({ publicationStatus: 'quarantined', manualHideReason: 'bad data' })
    expect(row.manuallyHiddenAt).toBeInstanceOf(Date)
    expect((await post('l1', { action: 'hide', reason: 'again' })).json().data.changed).toBe(false)
    expect(db.listing.update).toHaveBeenCalledTimes(1)
    expect((await post('l1', { action: 'requeue-resolve' })).statusCode).toBe(409)
    expect((await post('l1', { action: 'release-quarantine' })).statusCode).toBe(409)
    const unhide = await post('l1', { action: 'unhide' })
    expect(unhide.json().data.jobId).toBeTruthy()
    expect(row).toMatchObject({ manuallyHiddenAt: null, publicationStatus: 'pending' })
    expect(resolveQ.getEnqueued()).toHaveLength(1)
    await app.close()
  })

  it('mark-gone is idempotent', async () => {
    const row = { ...base }
    const { app, post } = await buildApp(row)
    expect((await post('l1', { action: 'mark-gone' })).json().data.changed).toBe(true)
    expect(row.status).toBe('gone')
    expect((await post('l1', { action: 'mark-gone' })).json().data.changed).toBe(false)
    expect((await post('l1', { action: 'requeue-resolve' })).statusCode).toBe(409)
    await app.close()
  })

  it('release-quarantine needs a quarantined listing, then queues resolve', async () => {
    const row = { ...base }
    const { app, post, audit } = await buildApp(row)
    expect((await post('l1', { action: 'release-quarantine' })).statusCode).toBe(409)
    expect(audit().at(-1)).toMatchObject({ after: { result: 'refused' } })
    row.publicationStatus = 'quarantined'
    const res = await post('l1', { action: 'release-quarantine' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.jobId).toBeTruthy()
    expect(row.publicationStatus).toBe('pending')
    await app.close()
  })

  it('requeue-vin-decode needs a VIN that is not yet decoded', async () => {
    const { app, post } = await buildApp({ ...base })
    expect((await post('l1', { action: 'requeue-vin-decode' })).json().data.jobId).toBeTruthy()
    await app.close()
    const b = await buildApp({ ...base, vin: null })
    expect((await b.post('l1', { action: 'requeue-vin-decode' })).statusCode).toBe(409)
    await b.app.close()
    const c = await buildApp({ ...base, vehicleModelId: 'vm' })
    expect((await c.post('l1', { action: 'requeue-vin-decode' })).statusCode).toBe(409)
    await c.app.close()
  })
})
