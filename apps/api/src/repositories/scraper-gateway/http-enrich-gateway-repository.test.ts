import { describe, expect, it, vi } from 'vitest'
import { HttpEnrichGatewayRepository } from './http-enrich-gateway-repository.js'

function repoWith(claimedIds: string[]) {
  const queryRaw = vi.fn(async () => claimedIds.map((id) => ({ id })))
  const db = { $queryRaw: queryRaw, listing: { findMany: vi.fn(async () => []) } }
  return { repo: new HttpEnrichGatewayRepository(db as never), queryRaw }
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
