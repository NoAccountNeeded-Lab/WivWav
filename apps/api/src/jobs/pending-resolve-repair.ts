/**
 * One-off repair for #1156: active listings stuck `pending` although detail
 * extraction already ran (`detailScrapedAt` set). Runs the normal listing-resolve
 * decision on them in rate-limited pages. Dry run by default.
 *
 * Usage:
 *   pnpm tsx apps/api/src/jobs/pending-resolve-repair.ts              (dry run: prints count)
 *   pnpm tsx apps/api/src/jobs/pending-resolve-repair.ts --apply [--limit N] [--delay-ms N]
 *
 * Rows that lose the optimistic-concurrency race are skipped and counted; rerun
 * to pick them up. Afterwards trigger the meilisearch-sync job.
 */
import type { PrismaClient } from '@wivwav/db'
import { resolveRow } from './listing-resolve.js'

const PAGE_SIZE = 50

export interface PendingRepairResult {
  found: number
  eligible: number
  quarantined: number
  skippedStale: number
}

const stuckWhere = {
  status: { not: 'gone' as const },
  publicationStatus: 'pending' as const,
  detailScrapedAt: { not: null },
}

export async function repairPendingListings(
  db: PrismaClient,
  options: { apply: boolean; limit?: number; delayMs?: number },
): Promise<PendingRepairResult> {
  const result: PendingRepairResult = { found: 0, eligible: 0, quarantined: 0, skippedStale: 0 }
  if (!options.apply) {
    result.found = await db.listing.count({ where: stuckWhere })
    return result
  }

  const max = options.limit ?? Infinity
  let cursor: string | undefined
  while (result.found < max) {
    const rows = await db.listing.findMany({
      where: stuckWhere,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      take: Math.min(PAGE_SIZE, max - result.found),
      orderBy: { id: 'asc' },
    })
    if (rows.length === 0) break
    for (const row of rows) {
      result.found++
      const outcome = await resolveRow(db, row, undefined)
      if (outcome === 'skipped-stale') result.skippedStale++
      else result[outcome]++
    }
    cursor = rows[rows.length - 1]!.id
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
  }
  return result
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const numArg = (name: string): number | undefined => {
    const raw = argv[argv.indexOf(name) + 1]
    const n = raw === undefined ? NaN : parseInt(raw, 10)
    return Number.isNaN(n) ? undefined : n
  }
  const apply = argv.includes('--apply')
  const limit = numArg('--limit')
  const { getDb } = await import('@wivwav/db')
  const result = await repairPendingListings(getDb(), {
    apply,
    ...(limit !== undefined ? { limit } : {}),
    delayMs: numArg('--delay-ms') ?? 200,
  })
  console.log(apply ? 'Applied:' : 'Dry run (use --apply to resolve):', result)
  process.exit(0)
}
