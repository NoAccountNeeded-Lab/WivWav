import type { PrismaClient, JobRun } from '@wivwav/db'

// ── Shape types ──────────────────────────────────────────────────────────────

export type JobRunRow = JobRun

/** A `JobRun` row with its direct/transitive children nested, forming a source's pipeline tree. */
export interface JobRunTreeNode extends JobRunRow {
  children: JobRunTreeNode[]
}

// ── Interface ────────────────────────────────────────────────────────────────

export interface JobRunRepository {
  /**
   * Every run attributable to `sourceId` (its `sourceId` column matches),
   * plus every run transitively spawned from one of those runs (regardless
   * of the spawned run's own `sourceId` — a spawned run inherits the
   * source's lineage through `parentRunId` even when its own payload carries
   * no `sourceId`, e.g. a `listing-resolve` run triggered by a source-scoped
   * `detail-extract`). Returned as a forest: top-level nodes are runs whose
   * parent (if any) fell outside this source's tree, each with `children`
   * nested by `parentRunId`, ordered oldest-first at every level.
   */
  findRunTreeForSource(sourceId: string): Promise<JobRunTreeNode[]>
}

// ── Prisma implementation ────────────────────────────────────────────────────

export class PrismaJobRunRepository implements JobRunRepository {
  constructor(private readonly db: PrismaClient) {}

  async findRunTreeForSource(sourceId: string): Promise<JobRunTreeNode[]> {
    // Plain UNION (not UNION ALL) is required, not just a style choice: a
    // descendant run can independently carry the same sourceId as its
    // source-scoped ancestor (e.g. a detail-extract row nested under a
    // source-scoped scrape row) and so also matches the anchor branch on its
    // own. With UNION ALL that row re-enters the working table on its own
    // account, and every iteration downstream re-derives its subtree again —
    // duplicating whole branches. UNION's per-iteration row dedup against the
    // accumulated result keeps each row (and thus each subtree) singular.
    const rows = await this.db.$queryRaw<JobRunRow[]>`
      WITH RECURSIVE run_tree AS (
        SELECT jr.* FROM job_run jr WHERE jr."sourceId" = ${sourceId}
        UNION
        SELECT jr.* FROM job_run jr
        INNER JOIN run_tree rt ON jr."parentRunId" = rt.id
      )
      SELECT rt.* FROM run_tree rt ORDER BY rt."startedAt" ASC
    `
    return buildForest(rows)
  }
}

function buildForest(rows: JobRunRow[]): JobRunTreeNode[] {
  const nodesById = new Map<string, JobRunTreeNode>()
  for (const row of rows) nodesById.set(row.id, { ...row, children: [] })

  // Defence in depth: link each distinct id exactly once, even if the query
  // ever returns a row more than once (see the UNION vs. UNION ALL note on
  // the query above for the case this actually guards against).
  const linked = new Set<string>()
  const roots: JobRunTreeNode[] = []
  for (const row of rows) {
    if (linked.has(row.id)) continue
    linked.add(row.id)
    const node = nodesById.get(row.id)
    if (!node) continue
    const parent = row.parentRunId ? nodesById.get(row.parentRunId) : undefined
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}
