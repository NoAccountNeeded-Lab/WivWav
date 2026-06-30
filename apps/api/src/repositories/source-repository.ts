import type { PrismaClient } from '@wivwav/db'

// ── Shape types ──────────────────────────────────────────────────────────────

export type SourceRow = {
  id: string
  name: string
  baseUrl: string
  status: string
  cronExpression: string
  lastScrapedAt: Date | null
  /** Timestamp of the most recent complete (all-pages) crawl. */
  lastFullCrawlAt: Date | null
  /** Timestamp of the most recent observation (complete or partial). */
  lastObservedAt: Date | null
  listingCount: number
  errorMessage: string | null
}

export type SourceNameRow = { id: string; name: string }

export type SourceIdRow = { id: string; name: string }

export type SourceScheduleRow = {
  id: string
  name: string
  cronExpression: string
  timezone: string
}

export type SourceRemappingRow = {
  id: string
  name: string
  errorMessage: string | null
  lastScrapedAt: Date | null
}

// ── Interface ────────────────────────────────────────────────────────────────

export interface SourceRepository {
  count(): Promise<number>
  countActive(): Promise<number>
  findAll(): Promise<SourceRow[]>
  findById(id: string): Promise<SourceIdRow | null>
  findManyByIds(ids: string[]): Promise<SourceNameRow[]>
  findScheduledSources(names: string[]): Promise<SourceScheduleRow[]>
  findNeedingRemapping(): Promise<SourceRemappingRow[]>
}

// ── Prisma implementation ────────────────────────────────────────────────────

export class PrismaSourceRepository implements SourceRepository {
  constructor(private readonly db: PrismaClient) {}

  count(): Promise<number> {
    return this.db.source.count()
  }

  countActive(): Promise<number> {
    return this.db.source.count({ where: { status: 'active' } })
  }

  findAll(): Promise<SourceRow[]> {
    return this.db.source.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        baseUrl: true,
        status: true,
        cronExpression: true,
        lastScrapedAt: true,
        lastFullCrawlAt: true,
        lastObservedAt: true,
        listingCount: true,
        errorMessage: true,
      },
    })
  }

  findById(id: string): Promise<SourceIdRow | null> {
    return this.db.source.findUnique({ where: { id }, select: { id: true, name: true } })
  }

  findManyByIds(ids: string[]): Promise<SourceNameRow[]> {
    if (ids.length === 0) return Promise.resolve([])
    return this.db.source.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
  }

  findScheduledSources(names: string[]): Promise<SourceScheduleRow[]> {
    return this.db.source.findMany({
      where: { name: { in: names } },
      select: { id: true, name: true, cronExpression: true, timezone: true },
    })
  }

  findNeedingRemapping(): Promise<SourceRemappingRow[]> {
    return this.db.source.findMany({
      where: { status: 'needs_remapping' },
      select: { id: true, name: true, errorMessage: true, lastScrapedAt: true },
      orderBy: { name: 'asc' },
    })
  }
}
