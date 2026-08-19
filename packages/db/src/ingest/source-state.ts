import { SourceStatus, type Prisma, type PrismaClient } from '../generated/prisma/index.js'
import type { WivWavLogger } from '@wivwav/logger'
import type { FieldMapping } from '@wivwav/types'
import { isRecordNotFoundError } from '../lib/prisma-errors.js'

/**
 * Source execution-state transitions (#948/#951): shared by apps/api's
 * admin-oriented PrismaSourceRepository and its worker gateway, one
 * implementation instead of a hand-copied port.
 */

export interface SourceExecutionState {
  status: 'active' | 'disabled' | 'paused' | 'error' | 'needs_remapping'
  errorMessage: string | null
}

export interface SourceDriftBaseline {
  baselineErrorRate: number
  baselineMissingRate: number
}

async function updateSource(
  db: PrismaClient,
  id: string,
  data: Prisma.SourceUpdateInput,
  logger?: WivWavLogger,
): Promise<void> {
  try {
    await db.source.update({ where: { id }, data })
  } catch (err) {
    if (!isRecordNotFoundError(err)) throw err
    logger?.warn({ sourceId: id }, 'Skipped source update: source no longer exists')
  }
}

export async function getSourceExecutionState(
  db: PrismaClient,
  id: string,
): Promise<SourceExecutionState | null> {
  return db.source.findUnique({ where: { id }, select: { status: true, errorMessage: true } })
}

export async function markSourceNeedsRemapping(
  db: PrismaClient,
  id: string,
  errorMessage = 'Structure changed — awaiting AI remap',
  logger?: WivWavLogger,
): Promise<void> {
  await updateSource(db, id, { status: 'needs_remapping', errorMessage }, logger)
}

export async function markSourceActive(
  db: PrismaClient,
  id: string,
  data: {
    listingCount: number
    fingerprintHash: string
    page1Hash?: string | undefined
    isCompleteCrawl: boolean
  },
  logger?: WivWavLogger,
): Promise<void> {
  const now = new Date()
  const result = await db.source.updateMany({
    where: {
      id,
      status: { notIn: [SourceStatus.paused, SourceStatus.disabled] },
    },
    data: {
      lastScrapedAt: now,
      lastObservedAt: now,
      listingCount: data.listingCount,
      fingerprintHash: data.fingerprintHash,
      ...(data.page1Hash !== undefined ? { page1Hash: data.page1Hash } : {}),
      ...(data.isCompleteCrawl ? { lastFullCrawlAt: now } : {}),
      status: 'active',
      errorMessage: null,
    },
  })
  if (result.count === 0) {
    logger?.warn(
      { sourceId: id },
      'Skipped source activation because the source is paused or disabled',
    )
  }
}

export async function markSourceChecked(
  db: PrismaClient,
  id: string,
  logger?: WivWavLogger,
): Promise<void> {
  const now = new Date()
  await updateSource(db, id, { lastCheckedAt: now, lastObservedAt: now }, logger)
  // Reset error status when a no-change check succeeds — the source is reachable
  await db.source.updateMany({
    where: { id, status: 'error' },
    data: { status: 'active', errorMessage: null },
  })
}

export async function markSourceError(
  db: PrismaClient,
  id: string,
  errorMessage: string,
  logger?: WivWavLogger,
): Promise<void> {
  await updateSource(db, id, { status: 'error', errorMessage }, logger)
}

export async function markSourcePaused(
  db: PrismaClient,
  id: string,
  reason: string,
  logger?: WivWavLogger,
): Promise<void> {
  await updateSource(db, id, { status: 'paused', errorMessage: reason }, logger)
}

export async function getSourceMappings(db: PrismaClient, id: string): Promise<FieldMapping[]> {
  const source = await db.source.findUnique({ where: { id }, select: { mappings: true } })
  return (source?.mappings ?? []) as unknown as FieldMapping[]
}

export async function setSourceMappings(
  db: PrismaClient,
  id: string,
  mappings: FieldMapping[],
  logger?: WivWavLogger,
): Promise<void> {
  await updateSource(db, id, { mappings: mappings as unknown as Prisma.InputJsonValue }, logger)
}

export async function getSourceLastFullCrawlAt(db: PrismaClient, id: string): Promise<Date | null> {
  const source = await db.source.findUnique({ where: { id }, select: { lastFullCrawlAt: true } })
  return source?.lastFullCrawlAt ?? null
}

export async function getSourceDriftBaseline(
  db: PrismaClient,
  id: string,
): Promise<SourceDriftBaseline | null> {
  const source = await db.source.findUnique({
    where: { id },
    select: { baselineErrorRate: true, baselineMissingRate: true },
  })
  if (source?.baselineErrorRate == null || source.baselineMissingRate == null) return null
  return {
    baselineErrorRate: source.baselineErrorRate,
    baselineMissingRate: source.baselineMissingRate,
  }
}

export async function setSourceDriftBaseline(
  db: PrismaClient,
  id: string,
  baseline: SourceDriftBaseline,
  logger?: WivWavLogger,
): Promise<void> {
  await updateSource(
    db,
    id,
    {
      baselineErrorRate: baseline.baselineErrorRate,
      baselineMissingRate: baseline.baselineMissingRate,
    },
    logger,
  )
}
