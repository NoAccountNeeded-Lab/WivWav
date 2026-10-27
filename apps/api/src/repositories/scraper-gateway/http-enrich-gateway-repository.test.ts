import { describe, expect, it, vi } from 'vitest'
import { HttpEnrichGatewayRepository } from './http-enrich-gateway-repository.js'

function repoWith(claimedIds: string[], writeCount = 1) {
  const updateMany = vi.fn(async (_args: object) => ({ count: writeCount }))
  const queryRaw = vi.fn(async () => claimedIds.map((id) => ({ id })))
  const db = { $queryRaw: queryRaw, listing: { findMany: vi.fn(async () => []), updateMany } }
  return { repo: new HttpEnrichGatewayRepository(db as never), queryRaw, updateMany }
}

const sqlText = (call: unknown[]) => (call[0] as { join(s: string): string }).join('?')

describe('claimVinEnrichListings', () => {
  it('batch claim keeps the unlinked-VIN filter and the live-lock guard', async () => {
    const { repo, queryRaw } = repoWith([])
    await repo.claimVinEnrichListings(10)
    const sql = sqlText(queryRaw.mock.calls[0] as unknown[])
    expect(sql).toContain('"processingLockedAt" IS NULL OR "processingLockedAt" <')
    expect(sql).toContain('FOR UPDATE SKIP LOCKED')
  })

  it('listing-scoped claim targets one id and keeps the same live-lock guard', async () => {
    const { repo, queryRaw } = repoWith([])
    await repo.claimVinEnrichListings(1, 'l1')
    const call = queryRaw.mock.calls[0] as unknown[]
    expect(call.flatMap((v) => (typeof v === 'object' && v && 'values' in v ? (v as { values: unknown[] }).values : [v]))).toContain('l1')
    expect(sqlText(call)).toContain('"processingLockedAt" IS NULL OR "processingLockedAt" <')
  })
})

describe('resolveVinEnrichListing lock release', () => {
  it('with a claim token, releases only that lock so a takeover by a newer worker survives', async () => {
    const { repo, updateMany } = repoWith([])
    const lockedAt = '2026-10-27T00:00:00.000Z'
    await repo.resolveVinEnrichListing({ listingId: 'l1', outcome: 'failed', lockedAt })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'l1', processingLockedAt: new Date(lockedAt) },
      data: { processingLockedAt: null },
    })
  })

  it('without a token, releases by id (legacy callers)', async () => {
    const { repo, updateMany } = repoWith([])
    await repo.resolveVinEnrichListing({ listingId: 'l1', outcome: 'failed' })
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { processingLockedAt: null } })
  })
})

describe('resolveVinEnrichListing guarded result write', () => {
  const lockedAt = '2026-10-27T00:00:00.000Z'
  const token = { id: 'l1', processingLockedAt: new Date(lockedAt) }

  it('guards the mismatched write on the claim token', async () => {
    const { repo, updateMany } = repoWith([])
    await repo.resolveVinEnrichListing({ listingId: 'l1', outcome: 'mismatched', qualityIssueCodes: ['x'], lockedAt })
    expect(updateMany.mock.calls[0]![0]).toMatchObject({ where: token, data: { publicationStatus: 'quarantined' } })
  })

  it('reports a lost claim and writes nothing else when the token no longer matches', async () => {
    const { repo, updateMany } = repoWith([], 0)
    const result = await repo.resolveVinEnrichListing({ listingId: 'l1', outcome: 'mismatched', qualityIssueCodes: [], lockedAt })
    expect(result).toEqual({ vehicleModelId: null, lostClaim: true })
    // result write + conditional release only; both carry the token
    for (const call of updateMany.mock.calls) expect(call[0]).toMatchObject({ where: token })
  })
})
