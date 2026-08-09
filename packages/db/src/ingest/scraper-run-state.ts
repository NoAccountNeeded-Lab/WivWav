import type { PrismaClient } from '../generated/prisma/index.js'

/**
 * ScraperRun lifecycle writes (#948/#951): shared by apps/scraper's
 * PrismaScraperRunRepository (until the cutover) and apps/api's worker
 * gateway, one implementation instead of a hand-copied port.
 */

export interface ScraperRunRecord {
  id: string
}

export async function startScraperRun(
  db: PrismaClient,
  sourceId: string,
): Promise<ScraperRunRecord> {
  return db.scraperRun.create({ data: { sourceId, startedAt: new Date() } })
}

export async function completeScraperRun(
  db: PrismaClient,
  id: string,
  listingsFound: number,
  changes: { listingsNew: number; listingsUpdated: number } = {
    listingsNew: 0,
    listingsUpdated: 0,
  },
): Promise<void> {
  await db.scraperRun.update({
    where: { id },
    data: { finishedAt: new Date(), success: true, listingsFound, ...changes },
  })
}

export async function failScraperRun(
  db: PrismaClient,
  id: string,
  errorMessage: string,
): Promise<void> {
  await db.scraperRun.update({
    where: { id },
    data: { finishedAt: new Date(), success: false, errorMessage },
  })
}
