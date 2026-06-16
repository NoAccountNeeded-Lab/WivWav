import type { PrismaClient, ScraperRun } from '@wivwav/db'

// ── Shape types ──────────────────────────────────────────────────────────────

export type ScraperRunRow = ScraperRun

export type LastScraperRunRow = { finishedAt: Date | null }

// ── Interface ────────────────────────────────────────────────────────────────

export interface ScraperRunRepository {
  findRecent(take: number): Promise<ScraperRunRow[]>
  findLastSuccessful(): Promise<LastScraperRunRow | null>
}

// ── Prisma implementation ────────────────────────────────────────────────────

export class PrismaScraperRunRepository implements ScraperRunRepository {
  constructor(private readonly db: PrismaClient) {}

  findRecent(take: number): Promise<ScraperRunRow[]> {
    return this.db.scraperRun.findMany({ orderBy: { startedAt: 'desc' }, take })
  }

  findLastSuccessful(): Promise<LastScraperRunRow | null> {
    return this.db.scraperRun.findFirst({
      where: { success: true, finishedAt: { not: null } },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    })
  }
}
