import { SourceStatus, type Prisma, type PrismaClient } from '@wivwav/db'
import type { WivWavLogger } from '@wivwav/logger'
import type { FieldMapping } from '@wivwav/types'

export interface SourceExecutionState {
  status: 'active' | 'disabled' | 'paused' | 'error' | 'needs_remapping'
  errorMessage: string | null
}

export interface SourceDriftBaseline {
  baselineErrorRate: number
  baselineMissingRate: number
}

/**
 * True for Prisma's "record not found" error (P2025). A Source row can be
 * deleted while a run is in flight — treating this as a no-op instead of
 * throwing keeps that case from crashing the run or masking whatever error
 * actually caused it to fail.
 */
function isRecordNotFoundError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  return (err as Record<string, unknown>)['code'] === 'P2025'
}

/**
 * Source-state transitions for the worker gateway (#951). Deliberately
 * separate from the admin-oriented SourceRepository in
 * ../source-repository.ts — same table, different surface. Mirrors
 * apps/scraper's PrismaSourceRepository (including the P2025-as-no-op and
 * paused/disabled markActive guard semantics) until the #948 cutover
 * deletes that copy.
 */
export class SourceGatewayRepository {
  constructor(private readonly db: PrismaClient, private readonly logger?: WivWavLogger) {}

  private async updateSource(id: string, data: Prisma.SourceUpdateInput): Promise<void> {
    try {
      await this.db.source.update({ where: { id }, data })
    } catch (err) {
      if (!isRecordNotFoundError(err)) throw err
      this.logger?.warn({ sourceId: id }, 'Skipped source update: source no longer exists')
    }
  }

  async getExecutionState(id: string): Promise<SourceExecutionState | null> {
    return this.db.source.findUnique({
      where: { id },
      select: { status: true, errorMessage: true },
    })
  }

  async markNeedsRemapping(id: string, errorMessage = 'Structure changed — awaiting AI remap'): Promise<void> {
    await this.updateSource(id, { status: 'needs_remapping', errorMessage })
  }

  async markActive(
    id: string,
    data: { listingCount: number; fingerprintHash: string; page1Hash?: string | undefined; isCompleteCrawl: boolean },
  ): Promise<void> {
    const now = new Date()
    const result = await this.db.source.updateMany({
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
      this.logger?.warn({ sourceId: id }, 'Skipped source activation because the source is paused or disabled')
    }
  }

  async markChecked(id: string): Promise<void> {
    const now = new Date()
    await this.updateSource(id, { lastCheckedAt: now, lastObservedAt: now })
    // Reset error status when a no-change check succeeds — the source is reachable
    await this.db.source.updateMany({ where: { id, status: 'error' }, data: { status: 'active', errorMessage: null } })
  }

  async markError(id: string, errorMessage: string): Promise<void> {
    await this.updateSource(id, { status: 'error', errorMessage })
  }

  async markPaused(id: string, reason: string): Promise<void> {
    await this.updateSource(id, { status: 'paused', errorMessage: reason })
  }

  async getMappings(id: string): Promise<FieldMapping[]> {
    const source = await this.db.source.findUnique({ where: { id }, select: { mappings: true } })
    return (source?.mappings ?? []) as unknown as FieldMapping[]
  }

  async setMappings(id: string, mappings: FieldMapping[]): Promise<void> {
    await this.updateSource(id, { mappings: mappings as unknown as Prisma.InputJsonValue })
  }

  async getLastFullCrawlAt(id: string): Promise<Date | null> {
    const source = await this.db.source.findUnique({ where: { id }, select: { lastFullCrawlAt: true } })
    return source?.lastFullCrawlAt ?? null
  }

  async getDriftBaseline(id: string): Promise<SourceDriftBaseline | null> {
    const source = await this.db.source.findUnique({
      where: { id },
      select: { baselineErrorRate: true, baselineMissingRate: true },
    })
    if (source?.baselineErrorRate == null || source.baselineMissingRate == null) return null
    return {
      baselineErrorRate: source.baselineErrorRate,
      baselineMissingRate: source.baselineMissingRate,
    }
  }

  async setDriftBaseline(id: string, baseline: SourceDriftBaseline): Promise<void> {
    await this.updateSource(id, {
      baselineErrorRate: baseline.baselineErrorRate,
      baselineMissingRate: baseline.baselineMissingRate,
    })
  }
}
