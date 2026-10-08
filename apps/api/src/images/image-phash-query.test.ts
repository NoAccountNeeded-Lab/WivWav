import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@wivwav/db'
import { findImagesWithinHammingDistance } from '@wivwav/db'
import { hammingDistance, PHASH_NEAR_DUPLICATE_THRESHOLD } from './image-hasher.js'
import { NEAR_DUPLICATE_HAMMING_THRESHOLD } from './image-integrity-analyzer.js'
import { clusterStoredNearDuplicates, findNearDuplicateImages } from './image-phash-query.js'

vi.mock('@wivwav/db', () => ({
  findImagesWithinHammingDistance: vi.fn(),
}))

const finder = vi.mocked(findImagesWithinHammingDistance)

function makeDb(): PrismaClient {
  return {} as PrismaClient
}

function row(id: string, pHash: string, hammingDistance = 0) {
  return { id, listingId: `L-${id}`, pHash, pHashInt: BigInt(1), hammingDistance }
}

describe('findNearDuplicateImages', () => {
  beforeEach(() => {
    finder.mockReset().mockResolvedValue([])
  })

  it('uses the shared threshold constant by default', async () => {
    // Single source of truth: the SQL predicate must agree with the analyzer.
    expect(NEAR_DUPLICATE_HAMMING_THRESHOLD).toBe(PHASH_NEAR_DUPLICATE_THRESHOLD)

    await findNearDuplicateImages(makeDb(), '0000000000000001')

    expect(finder).toHaveBeenCalledTimes(1)
    expect(finder).toHaveBeenCalledWith(
      expect.anything(),
      '0000000000000001',
      PHASH_NEAR_DUPLICATE_THRESHOLD,
      {},
    )
  })

  it('passes an explicit threshold and limit through', async () => {
    await findNearDuplicateImages(makeDb(), '0000000000000001', { threshold: 5, limit: 10 })

    expect(finder).toHaveBeenCalledWith(expect.anything(), '0000000000000001', 5, { limit: 10 })
  })
})

describe('clusterStoredNearDuplicates', () => {
  beforeEach(() => {
    finder.mockReset()
  })

  it('forms the same clusters as the in-memory greedy for one query per cluster', async () => {
    // A, B near each other; C far from both. Distances computed against the
    // real threshold constant so the mock honors production semantics.
    const candidates = [
      { id: 'a', pHash: '0000000000000000' },
      { id: 'b', pHash: '0000000000000001' },
      { id: 'c', pHash: 'ffffffffffffffff' },
    ]
    const finderImpl = async (_db: PrismaClient, repHash: string, threshold: number) =>
      candidates
        .filter((c) => hammingDistance(c.pHash, repHash) <= threshold)
        .map((c) => row(c.id, c.pHash))
    finder.mockImplementation(finderImpl)

    const clusters = await clusterStoredNearDuplicates(makeDb(), candidates)

    expect(clusters).toEqual([
      [
        { id: 'a', pHash: '0000000000000000' },
        { id: 'b', pHash: '0000000000000001' },
      ],
      [{ id: 'c', pHash: 'ffffffffffffffff' }],
    ])
    // One SQL query per formed cluster (seed lookups only); assigned member
    // `b` never triggers its own query.
    expect(finder).toHaveBeenCalledTimes(2)
  })

  it('restricts lookups to the candidate ids and ignores rows outside them', async () => {
    const candidates = [
      { id: 'a', pHash: '0000000000000000' },
      { id: 'b', pHash: '0000000000000001' },
    ]
    // The lookup returns b before a (identical-hash tiebreak) plus a ghost row.
    finder.mockResolvedValueOnce([
      row('b', '0000000000000001'),
      row('ghost', '0000000000000000'),
      row('a', '0000000000000000'),
    ])

    const clusters = await clusterStoredNearDuplicates(makeDb(), candidates)

    expect(finder).toHaveBeenCalledWith(
      expect.anything(),
      '0000000000000000',
      PHASH_NEAR_DUPLICATE_THRESHOLD,
      { ids: ['a', 'b'] },
    )
    // Seed first; `ghost` is not a candidate so it never joins.
    expect(clusters).toEqual([
      [
        { id: 'a', pHash: '0000000000000000' },
        { id: 'b', pHash: '0000000000000001' },
      ],
    ])
    expect(finder).toHaveBeenCalledTimes(1)
  })
})
