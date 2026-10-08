import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { disconnectDb, getDb, pHashHexToInt, upsertListingImage } from '@wivwav/db'
import type { PrismaClient } from '@wivwav/db'
import { hammingDistance } from './image-hasher.js'
import { greedyNearDuplicateClusters, NEAR_DUPLICATE_HAMMING_THRESHOLD } from './image-integrity-analyzer.js'
import { clusterStoredNearDuplicates, findNearDuplicateImages } from './image-phash-query.js'

// Covers #1115's acceptance criteria against a real, migrated Postgres:
// the Hamming predicate, the signed-int storage round-trip, and the
// single-query / bounded-query access patterns are worth verifying against a
// real query planner, not a mocked client.
const db: PrismaClient = getDb()

async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE "listing_image_semantic_analysis", "listing_image", "image_cluster", "listings", "sources" RESTART IDENTITY CASCADE
  `)
}

let fixtureCounter = 0

async function createListingWithImages(
  imageCount: number,
  hashFor: (index: number) => string | null,
): Promise<{ listingId: string; ids: string[] }> {
  fixtureCounter += 1
  const tag = `phash1115-${fixtureCounter}`
  const source = await db.source.create({
    data: { name: `pHash Test Source ${tag}`, baseUrl: `https://${tag}.example.com` },
  })
  const listing = await db.listing.create({
    data: {
      sourceId: source.id,
      sourceUrl: `https://${tag}.example.com/listing`,
      sourceRecordKey: `key-${tag}`,
      make: 'Toyota',
      model: 'Sienna',
      year: 2022,
      condition: 'used',
      sellerType: 'dealer',
      listedAt: new Date('2026-01-01'),
      status: 'active',
    },
  })
  const rows = Array.from({ length: imageCount }, (_, i) => {
    const pHash = hashFor(i)
    return {
      listingId: listing.id,
      originalUrl: `https://${tag}.example.com/photo-${String(i).padStart(5, '0')}.jpg`,
      normalizedUrl: `https://${tag}.example.com/photo-${String(i).padStart(5, '0')}.jpg`,
      position: i,
      kind: 'vehicle_photo' as const,
      pHash,
      pHashInt: pHash === null ? null : pHashHexToInt(pHash),
    }
  })
  await db.listingImage.createMany({ data: rows })
  const stored = await db.listingImage.findMany({
    where: { listingId: listing.id },
    select: { id: true },
    orderBy: { position: 'asc' },
  })
  return { listingId: listing.id, ids: stored.map((r) => r.id) }
}

/** Deterministic PRNG (mulberry32) so the 1k+ fixture is stable across runs. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomHex(rand: () => number, bits = 64): string {
  let out = ''
  for (let i = 0; i < bits / 4; i++) {
    out += Math.floor(rand() * 16).toString(16)
  }
  return out
}

/** Flip `count` distinct random bits of a 16-char hex hash. */
function flipBits(hex: string, count: number, rand: () => number): string {
  let value = BigInt(`0x${hex}`)
  const positions = new Set<number>()
  while (positions.size < count) {
    positions.add(Math.floor(rand() * 64))
  }
  for (const pos of positions) {
    value ^= BigInt(1) << BigInt(pos)
  }
  return value.toString(16).padStart(16, '0')
}

describe('findNearDuplicateImages (SQL Hamming lookup)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('returns exactly the within-threshold rows in a single query without loading the image set', async () => {
    const rand = mulberry32(1115)
    // 8 near-duplicate families (members 0–12 flips from a center) plus
    // 400 noise images; the query hash IS the first center, so its family is
    // included by construction while far flips and noise are excluded. The
    // exact expected set is computed by brute force in JS below.
    const centers = Array.from({ length: 8 }, () => randomHex(rand))
    const queryHash = centers[0]!
    const familySize = 100
    const noiseCount = 400
    const total = centers.length * familySize + noiseCount
    const hashes = new Map<number, string>()
    const hashFor = (index: number): string => {
      const family = Math.floor(index / familySize)
      let hex: string
      if (family < centers.length) {
        const slot = index % familySize
        hex = slot === 0 ? centers[family]! : flipBits(centers[family]!, 1 + Math.floor(rand() * 12), rand)
      } else {
        hex = randomHex(rand)
      }
      hashes.set(index, hex)
      return hex
    }
    const { ids } = await createListingWithImages(total, hashFor)
    expect(ids.length).toBeGreaterThan(1000)

    const expected = new Map<string, number>()
    for (const [index, hex] of hashes) {
      const dist = hammingDistance(hex, queryHash)
      if (dist <= NEAR_DUPLICATE_HAMMING_THRESHOLD) {
        expected.set(ids[index]!, dist)
      }
    }
    // The fixture must exercise inclusion, the distance-10 boundary, and
    // exclusion; fail loudly instead of asserting a vacuous empty set.
    expect(expected.size).toBeGreaterThan(0)
    expect(expected.size).toBeLessThan(total)

    const rawSpy = vi.spyOn(db, '$queryRaw')
    try {
      const matches = await findNearDuplicateImages(db, queryHash)
      // AC1: exactly one query — the image set is never loaded into memory.
      expect(rawSpy).toHaveBeenCalledTimes(1)

      expect(matches.length).toBe(expected.size)
      let previous = -1
      for (const m of matches) {
        expect(m.id).toBeDefined()
        expect(expected.get(m.id)).toBe(m.hammingDistance)
        // The SQL distance agrees with the JS implementation bit-for-bit.
        expect(m.hammingDistance).toBe(hammingDistance(m.pHash!, queryHash))
        expect(typeof m.hammingDistance).toBe('number')
        expect(m.hammingDistance).toBeGreaterThanOrEqual(previous)
        previous = m.hammingDistance
      }
    } finally {
      rawSpy.mockRestore()
    }
  })

  it('excludes rows with null pHashInt and honors limit', async () => {
    await createListingWithImages(3, (i) =>
      i === 0 ? '0000000000000000' : i === 1 ? '0000000000000001' : null,
    )

    const all = await findNearDuplicateImages(db, '0000000000000000')
    expect(all.map((m) => m.pHash)).toEqual(['0000000000000000', '0000000000000001'])

    const limited = await findNearDuplicateImages(db, '0000000000000000', { limit: 1 })
    expect(limited).toHaveLength(1)
    expect(limited[0]!.hammingDistance).toBe(0)
  })

  it('dual-writes pHashInt through upsertListingImage', async () => {
    fixtureCounter += 1
    const tag = `phash1115-dual-${fixtureCounter}`
    const source = await db.source.create({
      data: { name: `pHash Dual Source ${tag}`, baseUrl: `https://${tag}.example.com` },
    })
    const listing = await db.listing.create({
      data: {
        sourceId: source.id,
        sourceUrl: `https://${tag}.example.com/listing`,
        sourceRecordKey: `key-${tag}`,
        make: 'Toyota',
        model: 'Sienna',
        year: 2022,
        condition: 'used',
        sellerType: 'dealer',
        listedAt: new Date('2026-01-01'),
        status: 'active',
      },
    })
    await upsertListingImage(db, {
      listingId: listing.id,
      originalUrl: `https://${tag}.example.com/a.jpg`,
      normalizedUrl: `https://${tag}.example.com/a.jpg`,
      position: 0,
      pHash: 'ffffffffffffffff',
    })
    await upsertListingImage(db, {
      listingId: listing.id,
      originalUrl: `https://${tag}.example.com/b.jpg`,
      normalizedUrl: `https://${tag}.example.com/b.jpg`,
      position: 1,
      pHash: null,
    })

    const rows = await db.listingImage.findMany({
      where: { listingId: listing.id },
      orderBy: { position: 'asc' },
    })
    expect(rows[0]!.pHashInt).toBe(BigInt(-1))
    expect(rows[1]!.pHashInt).toBeNull()
  })

  it('backfills pHashInt from hex for legacy rows and skips malformed hashes', async () => {
    const { listingId } = await createListingWithImages(1, () => '0000000000000001')
    // Simulate pre-dual-write rows: valid hex, malformed hex, and null.
    await db.$executeRawUnsafe(
      `UPDATE "listing_image" SET "pHashInt" = NULL WHERE "listing_image"."listingId" = '${listingId}'`,
    )
    await db.listingImage.create({
      data: {
        listingId,
        originalUrl: 'https://legacy.example.com/malformed.jpg',
        normalizedUrl: 'https://legacy.example.com/malformed.jpg',
        position: 99,
        kind: 'vehicle_photo',
        pHash: 'not-a-hash',
        analysisVersion: 1,
        updatedAt: new Date(),
      },
    })
    // Mirrors prisma/migrations/20261008030000_add_listing_image_phash_int/migration.sql.
    await db.$executeRawUnsafe(`
      UPDATE "listing_image"
      SET "pHashInt" = (('x' || "listing_image"."pHash")::bit(64)::bigint)
      WHERE "listing_image"."pHash" IS NOT NULL
        AND "listing_image"."pHash" ~ '^[0-9a-fA-F]{16}$'
        AND "listing_image"."pHashInt" IS NULL
    `)

    const rows = await db.listingImage.findMany({
      where: { listingId },
      orderBy: { position: 'asc' },
    })
    expect(rows[0]!.pHashInt).toBe(BigInt(1))
    expect(rows[1]!.pHash).toBe('not-a-hash')
    expect(rows[1]!.pHashInt).toBeNull()
  })
})

describe('clusterStoredNearDuplicates (SQL batch parity)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('produces the same cluster assignments as the in-memory greedy pass 2 on a 1k+ fixture', async () => {
    const rand = mulberry32(20261115)
    const centers = Array.from({ length: 10 }, () => randomHex(rand))
    const familySize = 110
    const noiseCount = 200
    const total = centers.length * familySize + noiseCount
    const hashes: string[] = []
    const hashFor = (index: number): string => {
      const family = Math.floor(index / familySize)
      let hex: string
      if (family < centers.length) {
        const slot = index % familySize
        hex = slot < 2 ? centers[family]! : flipBits(centers[family]!, 1 + Math.floor(rand() * 12), rand)
      } else {
        hex = randomHex(rand)
      }
      hashes.push(hex)
      return hex
    }
    const { ids } = await createListingWithImages(total, hashFor)
    expect(ids.length).toBeGreaterThan(1000)

    const candidates = ids.map((id, i) => ({ id, pHash: hashes[i]! }))

    // Reference: the current greedy implementation (pass 2) over the same
    // candidates in the same order.
    const reference = greedyNearDuplicateClusters(candidates, (repHash) =>
      candidates.filter((c) => hammingDistance(c.pHash, repHash) <= NEAR_DUPLICATE_HAMMING_THRESHOLD),
    )

    const rawSpy = vi.spyOn(db, '$queryRaw')
    try {
      const actual = await clusterStoredNearDuplicates(db, candidates)
      // Bounded access: one SQL query per formed cluster (singletons form
      // one-member clusters too), never a full-table load per image.
      expect(rawSpy.mock.calls.length).toBe(reference.length)

      const normalize = (clusters: { id: string }[][]) =>
        clusters
          .map((m) => m.map((c) => c.id).sort())
          .sort((a, b) => (a[0]! < b[0]! ? -1 : 1))
      expect(normalize(actual)).toEqual(normalize(reference))
      // Non-vacuous: the fixture must actually form multi-member clusters.
      expect(actual.some((m) => m.length > 1)).toBe(true)
    } finally {
      rawSpy.mockRestore()
    }
  })
})
