import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@wivwav/db'
import { PrismaOpsProblemStateRepository } from './ops-problem-state-repository.js'

function buildDb(overrides: Partial<{
  upsert: ReturnType<typeof vi.fn>
  findUnique: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}>) {
  return {
    opsProblemState: {
      upsert: overrides.upsert ?? vi.fn(),
      findUnique: overrides.findUnique ?? vi.fn(),
      update: overrides.update ?? vi.fn(),
    },
  } as unknown as PrismaClient
}

const OBSERVED_AT = new Date('2026-07-23T09:00:00.000Z')

describe('PrismaOpsProblemStateRepository', () => {
  it('upserts observed fingerprints without resetting firstSeenAt on repeat observations', async () => {
    const row = {
      fingerprint: 'domain:source:stale',
      source: 'domain',
      firstSeenAt: new Date('2026-07-22T09:00:00.000Z'),
      lastSeenAt: OBSERVED_AT,
      occurrenceCount: 2,
      acknowledgedAt: null,
      acknowledgedBy: null,
    }
    const upsert = vi.fn(async () => row)
    const repo = new PrismaOpsProblemStateRepository(buildDb({ upsert }))

    await expect(repo.recordPass(
      [{ fingerprint: 'domain:source:stale', source: 'domain' }],
      OBSERVED_AT,
    )).resolves.toEqual([row])

    expect(upsert).toHaveBeenCalledWith({
      where: { fingerprint: 'domain:source:stale' },
      create: {
        fingerprint: 'domain:source:stale',
        source: 'domain',
        firstSeenAt: OBSERVED_AT,
        lastSeenAt: OBSERVED_AT,
        occurrenceCount: 1,
      },
      update: {
        source: 'domain',
        lastSeenAt: OBSERVED_AT,
        occurrenceCount: { increment: 1 },
      },
    })
  })

  it('records a duplicate fingerprint once per aggregation pass', async () => {
    const upsert = vi.fn(async () => ({
      fingerprint: 'grafana:alert:api',
      source: 'grafana',
      firstSeenAt: OBSERVED_AT,
      lastSeenAt: OBSERVED_AT,
      occurrenceCount: 1,
      acknowledgedAt: null,
      acknowledgedBy: null,
    }))
    const repo = new PrismaOpsProblemStateRepository(buildDb({ upsert }))

    await repo.recordPass([
      { fingerprint: 'grafana:alert:api', source: 'grafana' },
      { fingerprint: 'grafana:alert:api', source: 'grafana' },
    ], OBSERVED_AT)

    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('acknowledges and unacknowledges an existing row even when it is not in the active pass', async () => {
    const acknowledgedAt = new Date('2026-07-23T10:00:00.000Z')
    const existing = {
      fingerprint: 'domain:resolved-condition',
      source: 'domain',
      firstSeenAt: new Date('2026-07-20T10:00:00.000Z'),
      lastSeenAt: new Date('2026-07-21T10:00:00.000Z'),
      occurrenceCount: 3,
      acknowledgedAt: null,
      acknowledgedBy: null,
    }
    const findUnique = vi.fn(async () => existing)
    const update = vi.fn(async (_args) => existing)
    const repo = new PrismaOpsProblemStateRepository(buildDb({ findUnique, update }))

    await repo.setAcknowledgement({
      fingerprint: 'domain:resolved-condition',
      acknowledged: true,
      acknowledgedBy: 'operator@example.com',
      acknowledgedAt,
    })
    await repo.setAcknowledgement({
      fingerprint: 'domain:resolved-condition',
      acknowledged: false,
    })

    expect(update).toHaveBeenNthCalledWith(1, {
      where: { fingerprint: 'domain:resolved-condition' },
      data: { acknowledgedAt, acknowledgedBy: 'operator@example.com' },
    })
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { fingerprint: 'domain:resolved-condition' },
      data: { acknowledgedAt: null, acknowledgedBy: null },
    })
  })

  it('returns null when acknowledging an unknown fingerprint', async () => {
    const repo = new PrismaOpsProblemStateRepository(buildDb({ findUnique: vi.fn(async () => null) }))

    await expect(repo.setAcknowledgement({ fingerprint: 'missing', acknowledged: true })).resolves.toBeNull()
  })
})
