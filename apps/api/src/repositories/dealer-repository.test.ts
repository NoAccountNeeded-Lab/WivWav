import { describe, expect, it, vi } from 'vitest'
import { PrismaDealerRepository } from './dealer-repository.js'

describe('PrismaDealerRepository publish gate', () => {
  it('uses the current operator setting for dealer listing reads', async () => {
    vi.stubEnv('PUBLISH_GATE_STRICT', 'false')
    const db = {
      listing: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
      },
    }
    const getOperatorSetting = vi.fn(async () => true)
    const repo = new PrismaDealerRepository(db as never, { getOperatorSetting } as never)

    await repo.findListings('dealer-1', 'active', 0, 20)

    expect(getOperatorSetting).toHaveBeenCalledWith('publish_gate.strict', false)
    expect((db.listing.findMany.mock.calls as unknown[][])[0]?.[0]).toMatchObject({
      where: { readinessComputedAt: { not: null }, readinessBlockers: { isEmpty: true } },
    })
    vi.unstubAllEnvs()
  })
})
