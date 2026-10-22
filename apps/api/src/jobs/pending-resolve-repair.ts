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
import '../lib/load-env.js'

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
  detailStaleAt: null,
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
      if (outcome === 'skipped-stale' || outcome === 'held-detail-stale') result.skippedStale++
      else result[outcome]++
    }
    cursor = rows[rows.length - 1]!.id
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
  }
  return result
}

/** Strict CLI parsing: a bad numeric flag throws before any write. */
export function parseRepairArgs(argv: string[]): { apply: boolean; limit?: number; delayMs: number } {
  const known = new Set(['--apply', '--limit', '--delay-ms'])
  const num = (name: string, min: number): number | undefined => {
    const i = argv.indexOf(name)
    if (i < 0) return undefined
    const raw = argv[i + 1]
    if (raw === undefined || !/^\d+$/.test(raw) || Number(raw) < min) {
      throw new Error(`${name} needs an integer >= ${min}, got ${raw === undefined ? 'nothing' : `"${raw}"`}`)
    }
    return Number(raw)
  }
  const unknown = argv.filter((a) => a.startsWith('--') && !known.has(a))
  if (unknown.length > 0) throw new Error(`unknown option(s): ${unknown.join(', ')}`)
  const limit = num('--limit', 1)
  return {
    apply: argv.includes('--apply'),
    ...(limit !== undefined ? { limit } : {}),
    delayMs: num('--delay-ms', 0) ?? 200,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let options: ReturnType<typeof parseRepairArgs>
  try {
    options = parseRepairArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
  const { getDb } = await import('@wivwav/db')
  const result = await repairPendingListings(getDb(), options)
  console.log(options.apply ? 'Applied:' : 'Dry run (use --apply to resolve):', result)
  process.exit(0)
}
