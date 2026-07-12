import { SkeletonTableRows } from './Skeleton'
import opsStyles from '../app/ops/ops.module.css'

interface OpsTableSkeletonProps {
  /** Number of columns — should match the real table's `<th>` count so column widths don't jump. */
  columns: number
  /** Number of placeholder rows. Defaults to 6 — a reasonable approximation of typical row counts. */
  rows?: number
}

/**
 * Full `<table>` skeleton (wrapper + head + body) reusing the shared
 * `ops.module.css` table classes so cell padding and borders exactly match
 * the real table once data loads (E5, issue #732).
 */
export function OpsTableSkeleton({ columns, rows = 6 }: OpsTableSkeletonProps) {
  return (
    <div className={opsStyles.tableWrapper}>
      <table className={opsStyles.table}>
        <thead>
          <tr>
            {Array.from({ length: columns }, (_, i) => <th key={i}>&nbsp;</th>)}
          </tr>
        </thead>
        <tbody>
          <SkeletonTableRows rows={rows} columns={columns} />
        </tbody>
      </table>
    </div>
  )
}
