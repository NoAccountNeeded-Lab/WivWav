import { completeScraperRun, failScraperRun, startScraperRun, type PrismaClient } from '@wivwav/db'

/**
 * Scraper-run lifecycle writes for the worker gateway (#951). Deliberately a
 * separate class from the admin-oriented PrismaScraperRunRepository in
 * ../scraper-run-repository.ts — same table, different surface — but both
 * classes delegate to the one shared implementation in @wivwav/db.
 */
export class ScraperRunGatewayRepository {
  constructor(private readonly db: PrismaClient) {}

  async start(sourceId: string): Promise<{ id: string }> {
    return startScraperRun(this.db, sourceId)
  }

  async complete(
    id: string,
    listingsFound: number,
    changes?: { listingsNew: number; listingsUpdated: number },
  ): Promise<void> {
    await completeScraperRun(this.db, id, listingsFound, changes)
  }

  async fail(id: string, errorMessage: string): Promise<void> {
    await failScraperRun(this.db, id, errorMessage)
  }
}
