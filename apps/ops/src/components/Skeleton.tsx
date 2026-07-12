import styles from './Skeleton.module.css'

/* ── Skeleton primitives ───────────────────────────────────────────────────
   Fixed-dimension loading placeholders for the ops console (D8: zero-jump
   skeletons). Every variant reserves the exact footprint of the content it
   stands in for, so swapping the skeleton for real content never shifts
   layout. Shimmer is decorative only and is removed under
   prefers-reduced-motion (see Skeleton.module.css); dimensions never change.
   All variants are `aria-hidden` — a consumer showing one of these should
   pair it with its own live-region status text (adopted in E5/E7).
────────────────────────────────────────────────────────────────────────────── */

interface SkeletonCardProps {
  /** Number of body line placeholders below the title bar. Defaults to 2. */
  lines?: number
  className?: string | undefined
}

/**
 * Placeholder for a stat/summary card: a title bar plus N body lines.
 * Fixed height regardless of `lines` count differences between renders.
 */
export function SkeletonCard({ lines = 2, className }: SkeletonCardProps) {
  return (
    <div className={[styles.card, className].filter(Boolean).join(' ')} aria-hidden="true">
      <span className={[styles.block, styles.cardTitle].join(' ')} />
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className={[styles.block, styles.cardLine].join(' ')}
          data-short={i === lines - 1 ? 'true' : 'false'}
        />
      ))}
    </div>
  )
}

interface SkeletonChartBoxProps {
  /** CSS aspect-ratio value, e.g. "16/9" or "4/1". Defaults to "16/9". */
  aspectRatio?: string
  className?: string | undefined
}

/**
 * Placeholder for a chart region. Reserves the chart's final aspect ratio
 * so the surrounding layout does not reflow once real data renders.
 */
export function SkeletonChartBox({ aspectRatio = '16/9', className }: SkeletonChartBoxProps) {
  return (
    <div
      className={[styles.block, styles.chartBox, className].filter(Boolean).join(' ')}
      style={{ aspectRatio }}
      aria-hidden="true"
    />
  )
}

interface SkeletonListRowProps {
  /** Number of rows to render. Defaults to 1. */
  count?: number
  className?: string | undefined
}

/**
 * Placeholder for one or more list rows (avatar + two lines), each with a
 * fixed height matching the real row it stands in for.
 */
export function SkeletonListRow({ count = 1, className }: SkeletonListRowProps) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={[styles.listRow, className].filter(Boolean).join(' ')} aria-hidden="true">
          <span className={[styles.block, styles.listAvatar].join(' ')} />
          <span className={styles.listLines}>
            <span className={[styles.block, styles.listLineWide].join(' ')} />
            <span className={[styles.block, styles.listLineNarrow].join(' ')} />
          </span>
        </div>
      ))}
    </>
  )
}

interface SkeletonTableRowsProps {
  /** Number of placeholder `<tr>` rows to render. Defaults to 6. */
  rows?: number
  /** Number of `<td>` cells per row — should match the real table's column count. */
  columns: number
}

/**
 * Placeholder `<tr>` rows for a data table, each cell reserving the real
 * table's fixed `td` padding via the caller's table CSS. Intended to be
 * rendered inside a real `<table><tbody>` so column widths and row heights
 * inherit from that table's own styling — only the cell content is a
 * skeleton block.
 */
export function SkeletonTableRows({ rows = 6, columns }: SkeletonTableRowsProps) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} className={styles.tableCell}>
              <span
                className={[styles.block, styles.tableCellBlock].join(' ')}
                data-narrow={c === columns - 1 ? 'true' : undefined}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
