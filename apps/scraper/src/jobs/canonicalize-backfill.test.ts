import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))
vi.mock('../lib/queue-factory.js', () => ({ getQueueFactory: vi.fn() }))

import { getDb } from '@wivwav/db'
import { getQueueFactory } from '../lib/queue-factory.js'
import { runBackfill, COLOR_FIELD_BLEED_PATTERN } from './canonicalize-backfill.js'

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    listing: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function makeQueueFactory() {
  const resolutionQueue = { add: vi.fn().mockResolvedValue(undefined) }
  const factory = {
    createQueue: vi.fn().mockReturnValue(resolutionQueue),
    close: vi.fn().mockResolvedValue(undefined),
  }
  return { factory, resolutionQueue }
}

/** Queues the three sequential findMany calls runBackfill makes: engine, converter, color. */
function queueFindMany(
  db: ReturnType<typeof makeDb>,
  { engine = [], converter = [], color = [] }: { engine?: unknown[]; converter?: unknown[]; color?: unknown[] } = {},
) {
  db.listing.findMany
    .mockResolvedValueOnce(engine)
    .mockResolvedValueOnce(converter)
    .mockResolvedValueOnce(color)
}

describe('COLOR_FIELD_BLEED_PATTERN', () => {
  it.each([
    'Conv MakeEldorado',
    'Conv MakeOther',
    'Conv MakeBraunAbility',
    'Conversion Rear Entry',
    'Mileage 68,509',
    'Stock TR218378',
  ])('matches leaked field-label value %j', (value) => {
    expect(COLOR_FIELD_BLEED_PATTERN.test(value)).toBe(true)
  })

  it.each(['Grey', 'White', 'Silver', 'Black', 'Tan'])('does not match a real color %j', (value) => {
    expect(COLOR_FIELD_BLEED_PATTERN.test(value)).toBe(false)
  })
})

describe('runBackfill — color field-bleed detection', () => {
  let db: ReturnType<typeof makeDb>
  let queue: ReturnType<typeof makeQueueFactory>

  beforeEach(() => {
    vi.clearAllMocks()
    db = makeDb()
    vi.mocked(getDb).mockReturnValue(db as never)
    queue = makeQueueFactory()
    vi.mocked(getQueueFactory).mockReturnValue(queue.factory as never)
  })

  it('reports zero color fixes when there are none', async () => {
    queueFindMany(db)
    const report = await runBackfill({ apply: false })
    expect(report.colorFieldBleedFixes.total).toBe(0)
  })

  it('detects a field-bled color value and does not write in report mode', async () => {
    queueFindMany(db, {
      color: [
        { id: 'l-1', sourceId: 'src-1', color: 'Conv MakeEldorado', source: { name: 'MobilityWorks' } },
      ],
    })

    const report = await runBackfill({ apply: false })

    expect(report.colorFieldBleedFixes.total).toBe(1)
    expect(report.colorFieldBleedFixes.bySource['MobilityWorks']).toBe(1)
    expect(report.colorFieldBleedFixes.sampleValues['Conv MakeEldorado']).toBe(1)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('leaves a legitimate color value untouched', async () => {
    queueFindMany(db, {
      color: [{ id: 'l-1', sourceId: 'src-1', color: 'Grey', source: { name: 'MobilityWorks' } }],
    })

    const report = await runBackfill({ apply: false })

    expect(report.colorFieldBleedFixes.total).toBe(0)
  })

  it('nulls out the color and invalidates publication status when apply is true', async () => {
    queueFindMany(db, {
      color: [
        { id: 'l-1', sourceId: 'src-1', color: 'Conv MakeEldorado', source: { name: 'MobilityWorks' } },
      ],
    })

    await runBackfill({ apply: true })

    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.listing.update).toHaveBeenCalledWith({
      where: { id: 'l-1' },
      data: { color: null, publicationStatus: 'pending' },
    })
  })

  it('enqueues a listing-resolve job for every row corrected by --apply (#652)', async () => {
    queueFindMany(db, {
      color: [
        { id: 'l-1', sourceId: 'src-1', color: 'Conv MakeEldorado', source: { name: 'MobilityWorks' } },
        { id: 'l-2', sourceId: 'src-1', color: 'Conv MakeOther', source: { name: 'MobilityWorks' } },
      ],
    })

    await runBackfill({ apply: true })

    expect(queue.resolutionQueue.add).toHaveBeenCalledTimes(2)
    expect(queue.resolutionQueue.add).toHaveBeenCalledWith(
      { listingId: 'l-1', observationReference: expect.stringContaining('canonicalize-backfill:') },
      expect.anything(),
    )
    expect(queue.resolutionQueue.add).toHaveBeenCalledWith(
      { listingId: 'l-2', observationReference: expect.stringContaining('canonicalize-backfill:') },
      expect.anything(),
    )
    expect(queue.factory.close).toHaveBeenCalledTimes(1)
  })

  it('does not touch the resolution queue in report mode', async () => {
    queueFindMany(db, {
      color: [{ id: 'l-1', sourceId: 'src-1', color: 'Conv MakeEldorado', source: { name: 'MobilityWorks' } }],
    })

    await runBackfill({ apply: false })

    expect(getQueueFactory).not.toHaveBeenCalled()
  })

  it('tallies multiple affected rows by source and value', async () => {
    queueFindMany(db, {
      color: [
        { id: 'l-1', sourceId: 'src-1', color: 'Conv MakeEldorado', source: { name: 'MobilityWorks' } },
        { id: 'l-2', sourceId: 'src-1', color: 'Conv MakeOther', source: { name: 'MobilityWorks' } },
        { id: 'l-3', sourceId: 'src-1', color: 'Conv MakeEldorado', source: { name: 'MobilityWorks' } },
      ],
    })

    const report = await runBackfill({ apply: false })

    expect(report.colorFieldBleedFixes.total).toBe(3)
    expect(report.colorFieldBleedFixes.bySource['MobilityWorks']).toBe(3)
    expect(report.colorFieldBleedFixes.sampleValues['Conv MakeEldorado']).toBe(2)
    expect(report.colorFieldBleedFixes.sampleValues['Conv MakeOther']).toBe(1)
  })
})
