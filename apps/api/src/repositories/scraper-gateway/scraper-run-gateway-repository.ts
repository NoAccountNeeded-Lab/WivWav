import type { PrismaClient } from '@wivwav/db'

/**
 * Scraper-run lifecycle writes for the worker gateway (#951). Deliberately
 * separate from the admin-oriented ScraperRunRepository in
 * ../scraper-run-repository.ts — same table, different surface. Mirrors
 * apps/scraper's PrismaScraperRunRepository until the #948 cutover deletes
 * that copy.
 */
export class ScraperRunGatewayRepository {
  constructor(private readonly db: PrismaClient) {}

  async start(sourceId: string): Promise<{ id: string }> {
    const run = await this.db.scraperRun.create({ data: { sourceId, startedAt: new Date() } })
    return { id: run.id }
  }

  async complete(
    id: string,
    listingsFound: number,
    changes: { listingsNew: number; listingsUpdated: number } = { listingsNew: 0, listingsUpdated: 0 },
  ): Promise<void> {
    await this.db.scraperRun.update({
      where: { id },
      data: { finishedAt: new Date(), success: true, listingsFound, ...changes },
    })
  }

  async fail(id: string, errorMessage: string): Promise<void> {
    await this.db.scraperRun.update({
      where: { id },
      data: { finishedAt: new Date(), success: false, errorMessage },
    })
  }
}
