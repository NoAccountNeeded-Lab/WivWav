import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/index.js'
import {
  appendPrivateSellerDeletionAuditEntry,
  listPrivateSellerDeletionAuditEntries,
  PRIVATE_SELLER_DELETION_AUDIT_KEY_PREFIX,
} from './operator-intent.js'

function makeDb(rows: Array<{ value: unknown }> = []) {
  return {
    configEntry: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'cfg-1', ...data })),
      findMany: vi.fn(async () => rows),
    },
  } as unknown as PrismaClient
}

describe('appendPrivateSellerDeletionAuditEntry', () => {
  it('should write an append-only config entry keyed by listingId', async () => {
    const db = makeDb()

    await appendPrivateSellerDeletionAuditEntry(db, 'listing-1', {
      action: 'automated-retention',
      outcome: 'applied',
      fieldsCleared: ['dealerPhone', 'description'],
    })

    expect(db.configEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: `${PRIVATE_SELLER_DELETION_AUDIT_KEY_PREFIX}listing-1`,
          type: 'json',
        }),
      }),
    )
  })

  it('should record the operator and reason for a manual deletion request', async () => {
    const db = makeDb()

    await appendPrivateSellerDeletionAuditEntry(db, 'listing-1', {
      action: 'operator-request',
      outcome: 'failed',
      fieldsCleared: [],
      reason: 'Seller requested removal',
      requestedBy: 'ops-operator',
      errorMessage: 'Meilisearch unavailable',
    })

    const call = vi.mocked(db.configEntry.create).mock.calls[0]![0] as { data: { value: Record<string, unknown> } }
    expect(call.data.value).toMatchObject({
      action: 'operator-request',
      outcome: 'failed',
      reason: 'Seller requested removal',
      requestedBy: 'ops-operator',
      errorMessage: 'Meilisearch unavailable',
    })
  })
})

describe('listPrivateSellerDeletionAuditEntries', () => {
  it('should return entries newest first as written by findMany ordering', async () => {
    const db = makeDb([
      {
        value: {
          action: 'automated-retention',
          outcome: 'applied',
          fieldsCleared: ['description'],
          updatedAt: '2026-08-20T00:00:00.000Z',
        },
      },
    ])

    const entries = await listPrivateSellerDeletionAuditEntries(db, 'listing-1')

    expect(entries).toEqual([
      {
        listingId: 'listing-1',
        action: 'automated-retention',
        outcome: 'applied',
        fieldsCleared: ['description'],
        reason: null,
        requestedBy: null,
        errorMessage: null,
        updatedAt: '2026-08-20T00:00:00.000Z',
      },
    ])
  })

  it('should skip malformed rows instead of throwing', async () => {
    const db = makeDb([{ value: { garbage: true } }])

    const entries = await listPrivateSellerDeletionAuditEntries(db, 'listing-1')

    expect(entries).toEqual([])
  })

  it('should return an empty array when no audit history exists', async () => {
    const db = makeDb([])

    const entries = await listPrivateSellerDeletionAuditEntries(db, 'listing-1')

    expect(entries).toEqual([])
  })
})
