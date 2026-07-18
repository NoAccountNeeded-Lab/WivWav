import type { ReactNode } from 'react'
import styles from './DataTable.module.css'

export interface DataTableColumn {
  key: string
  label: ReactNode
  align?: 'start' | 'end'
}

interface DataTableProps {
  ariaLabel: string
  caption?: string
  columns: DataTableColumn[]
  children: ReactNode
}

export function DataTable({ ariaLabel, caption, columns, children }: DataTableProps) {
  return (
    <div className={styles.wrapper}>
      <table className={styles.table} aria-label={ariaLabel}>
        {caption ? <caption className={styles.srOnly}>{caption}</caption> : null}
        <thead className={styles.head}>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.align === 'end' ? styles.numeric : undefined}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={styles.body}>{children}</tbody>
      </table>
    </div>
  )
}

export { styles as dataTableStyles }
