import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { describe, expect, it, vi } from 'vitest'
import { adminVehicleIdentityRoutes } from './admin-vehicle-identity.js'
import { NotFoundError } from '../repositories/vehicle-identity-decision-repository.js'
import type { VehicleIdentityDecisionRepository } from '../repositories/vehicle-identity-decision-repository.js'
import { VehicleIdentityDecisionState } from '../repositories/vehicle-identity-decision-repository.js'

function makeDecision(overrides: Record<string, unknown> = {}) {
  return {
    id: 'decision-1',
    listingAId: 'listing-a',
    listingBId: 'listing-b',
    vehicleId: null,
    state: VehicleIdentityDecisionState.candidate,
    signals: { score: 55, stableIdentifierMatch: false, signals: [] },
    ruleId: 'non-vin-matcher-v1',
    decidedAt: new Date('2026-06-30T00:00:00Z'),
    createdAt: new Date('2026-06-30T00:00:00Z'),
    updatedAt: new Date('2026-06-30T00:00:00Z'),
    ...overrides,
  }
}

function makeCandidateRow(overrides: Record<string, unknown> = {}) {
  const listingSnapshot = {
    id: 'listing-x',
    make: 'Toyota',
    model: 'Sienna',
    year: 2022,
    trim: 'XLE',
    vin: null,
    priceCents: 4500000,
    mileage: 32000,
    sourceUrl: 'https://example.com/listing-x',
    city: 'Nashville',
    state: 'TN',
    dealerName: 'Dealer A',
  }
  return {
    ...makeDecision(),
    listingA: { ...listingSnapshot, id: 'listing-a' },
    listingB: { ...listingSnapshot, id: 'listing-b', dealerName: 'Dealer B' },
    ...overrides,
  }
}

function buildDefaultRepo(overrides: Partial<Record<keyof VehicleIdentityDecisionRepository, unknown>> = {}): VehicleIdentityDecisionRepository {
  return {
    listCandidates: vi.fn(async () => ({ data: [], total: 0 })),
    findById: vi.fn(async () => null),
    approve: vi.fn(async () => makeDecision({ state: VehicleIdentityDecisionState.verified, vehicleId: 'vehicle-1' })),
    reject: vi.fn(async () => makeDecision({ state: VehicleIdentityDecisionState.rejected })),
    split: vi.fn(async () => makeDecision({ state: VehicleIdentityDecisionState.split })),
    undoSplit: vi.fn(async () => makeDecision({ state: VehicleIdentityDecisionState.candidate })),
    ...overrides,
  } as VehicleIdentityDecisionRepository
}

function buildTestApp(repo: VehicleIdentityDecisionRepository) {
  const app = Fastify()
  void app.register(sensible)
  void app.register(adminVehicleIdentityRoutes, { vehicleIdentityDecisions: repo })
  return app
}

describe('GET /candidates', () => {
  it('should return empty list when no candidates exist', async () => {
    const repo = buildDefaultRepo()
    const app = buildTestApp(repo)
    const res = await app.inject({ method: 'GET', url: '/candidates' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual([])
    expect(body.meta).toEqual({ total: 0, skip: 0, take: 50 })
    await app.close()
  })

  it('should return candidates with listing snapshots and signals', async () => {
    const candidate = makeCandidateRow()
    const repo = buildDefaultRepo({
      listCandidates: vi.fn(async () => ({ data: [candidate], total: 1 })),
    })
    const app = buildTestApp(repo)
    const res = await app.inject({ method: 'GET', url: '/candidates' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('decision-1')
    expect(body.data[0].listingA.id).toBe('listing-a')
    expect(body.data[0].listingB.id).toBe('listing-b')
    expect(body.data[0].signals).toEqual({ score: 55, stableIdentifierMatch: false, signals: [] })
    expect(body.meta.total).toBe(1)
    await app.close()
  })

  it('should respect pagination parameters', async () => {
    const repo = buildDefaultRepo()
    const app = buildTestApp(repo)
    const res = await app.inject({ method: 'GET', url: '/candidates?skip=10&take=20' })
    expect(res.statusCode).toBe(200)
    expect(res.json().meta).toMatchObject({ skip: 10, take: 20 })
    expect(repo.listCandidates).toHaveBeenCalledWith({ skip: 10, take: 20 })
    await app.close()
  })

  it('should cap take at MAX_PAGE_SIZE (200)', async () => {
    const repo = buildDefaultRepo()
    const app = buildTestApp(repo)
    const res = await app.inject({ method: 'GET', url: '/candidates?take=999' })
    expect(res.statusCode).toBe(200)
    expect(res.json().meta.take).toBe(200)
    await app.close()
  })
})

describe('POST /candidates/:id/approve', () => {
  it('should approve a candidate and return the updated decision', async () => {
    const approved = makeDecision({ state: VehicleIdentityDecisionState.verified, vehicleId: 'vehicle-1' })
    const repo = buildDefaultRepo({ approve: vi.fn(async () => approved) })
    const app = buildTestApp(repo)
    const res = await app.inject({ method: 'POST', url: '/candidates/decision-1/approve' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.state).toBe(VehicleIdentityDecisionState.verified)
    expect(body.data.vehicleId).toBe('vehicle-1')
    expect(repo.approve).toHaveBeenCalledWith('decision-1')
    await app.close()
  })

  it('should return 404 when decision not found', async () => {
    const repo = buildDefaultRepo({
      approve: vi.fn(async () => { throw new NotFoundError('Vehicle identity decision "missing" not found') }),
    })
    const app = buildTestApp(repo)
    const res = await app.inject({ method: 'POST', url: '/candidates/missing/approve' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('should be idempotent — repeated approve returns same state', async () => {
    const approved = makeDecision({ state: VehicleIdentityDecisionState.verified, vehicleId: 'vehicle-1' })
    const approve = vi.fn(async () => approved)
    const repo = buildDefaultRepo({ approve })
    const app = buildTestApp(repo)

    const res1 = await app.inject({ method: 'POST', url: '/candidates/decision-1/approve' })
    const res2 = await app.inject({ method: 'POST', url: '/candidates/decision-1/approve' })

    expect(res1.statusCode).toBe(200)
    expect(res2.statusCode).toBe(200)
    expect(res1.json().data.state).toBe(res2.json().data.state)
    expect(approve).toHaveBeenCalledTimes(2)
    await app.close()
  })
})

describe('POST /candidates/:id/reject', () => {
  it('should reject a candidate and return the updated decision', async () => {
    const rejected = makeDecision({ state: VehicleIdentityDecisionState.rejected })
    const repo = buildDefaultRepo({ reject: vi.fn(async () => rejected) })
    const app = buildTestApp(repo)
    const res = await app.inject({ method: 'POST', url: '/candidates/decision-1/reject' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.state).toBe(VehicleIdentityDecisionState.rejected)
    expect(body.data.vehicleId).toBeNull()
    expect(repo.reject).toHaveBeenCalledWith('decision-1')
    await app.close()
  })

  it('should return 404 when decision not found', async () => {
    const repo = buildDefaultRepo({
      reject: vi.fn(async () => { throw new NotFoundError('not found') }),
    })
    const app = buildTestApp(repo)
    const res = await app.inject({ method: 'POST', url: '/candidates/missing/reject' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('should be idempotent — repeated reject returns same state', async () => {
    const rejected = makeDecision({ state: VehicleIdentityDecisionState.rejected })
    const reject = vi.fn(async () => rejected)
    const repo = buildDefaultRepo({ reject })
    const app = buildTestApp(repo)

    const res1 = await app.inject({ method: 'POST', url: '/candidates/decision-1/reject' })
    const res2 = await app.inject({ method: 'POST', url: '/candidates/decision-1/reject' })

    expect(res1.statusCode).toBe(200)
    expect(res2.statusCode).toBe(200)
    expect(res1.json().data.state).toBe(res2.json().data.state)
    expect(reject).toHaveBeenCalledTimes(2)
    await app.close()
  })
})

describe('POST /candidates/:id/split', () => {
  it('should split a verified decision and return the updated decision', async () => {
    const split = makeDecision({ state: VehicleIdentityDecisionState.split })
    const repo = buildDefaultRepo({ split: vi.fn(async () => split) })
    const app = buildTestApp(repo)
    const res = await app.inject({ method: 'POST', url: '/candidates/decision-1/split' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.state).toBe(VehicleIdentityDecisionState.split)
    expect(body.data.vehicleId).toBeNull()
    expect(repo.split).toHaveBeenCalledWith('decision-1')
    await app.close()
  })

  it('should return 404 when decision not found', async () => {
    const repo = buildDefaultRepo({
      split: vi.fn(async () => { throw new NotFoundError('not found') }),
    })
    const app = buildTestApp(repo)
    const res = await app.inject({ method: 'POST', url: '/candidates/missing/split' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('should be idempotent — repeated split returns same state', async () => {
    const splitDecision = makeDecision({ state: VehicleIdentityDecisionState.split })
    const splitFn = vi.fn(async () => splitDecision)
    const repo = buildDefaultRepo({ split: splitFn })
    const app = buildTestApp(repo)

    const res1 = await app.inject({ method: 'POST', url: '/candidates/decision-1/split' })
    const res2 = await app.inject({ method: 'POST', url: '/candidates/decision-1/split' })

    expect(res1.statusCode).toBe(200)
    expect(res2.statusCode).toBe(200)
    expect(res1.json().data.state).toBe(res2.json().data.state)
    expect(splitFn).toHaveBeenCalledTimes(2)
    await app.close()
  })
})

describe('POST /candidates/:id/undo-split', () => {
  it('should undo a split decision and return the candidate state', async () => {
    const undone = makeDecision({ state: VehicleIdentityDecisionState.candidate })
    const repo = buildDefaultRepo({ undoSplit: vi.fn(async () => undone) })
    const app = buildTestApp(repo)
    const res = await app.inject({ method: 'POST', url: '/candidates/decision-1/undo-split' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.state).toBe(VehicleIdentityDecisionState.candidate)
    expect(repo.undoSplit).toHaveBeenCalledWith('decision-1')
    await app.close()
  })

  it('should return 404 when decision not found', async () => {
    const repo = buildDefaultRepo({
      undoSplit: vi.fn(async () => { throw new NotFoundError('not found') }),
    })
    const app = buildTestApp(repo)
    const res = await app.inject({ method: 'POST', url: '/candidates/missing/undo-split' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('should be idempotent — undo-split on a non-split decision returns as-is', async () => {
    // Already candidate state (undo-split is a no-op on non-split)
    const candidate = makeDecision({ state: VehicleIdentityDecisionState.candidate })
    const undoSplit = vi.fn(async () => candidate)
    const repo = buildDefaultRepo({ undoSplit })
    const app = buildTestApp(repo)

    const res1 = await app.inject({ method: 'POST', url: '/candidates/decision-1/undo-split' })
    const res2 = await app.inject({ method: 'POST', url: '/candidates/decision-1/undo-split' })

    expect(res1.statusCode).toBe(200)
    expect(res2.statusCode).toBe(200)
    expect(res1.json().data.state).toBe(VehicleIdentityDecisionState.candidate)
    expect(res2.json().data.state).toBe(VehicleIdentityDecisionState.candidate)
    expect(undoSplit).toHaveBeenCalledTimes(2)
    await app.close()
  })
})
