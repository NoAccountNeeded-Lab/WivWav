'use client'

import type { ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import styles from './WorkspaceResizableSplit.module.css'

export interface WorkspaceResizableSplitProps {
  /** Accessible name for the pair, e.g. "Logs and metrics split". */
  label: string
  first: ReactNode
  second: ReactNode
  /** Initial size of `first`, 0–100 (percent). Defaults to an even split. */
  defaultFirstSize?: number
  orientation?: 'horizontal' | 'vertical'
}

/**
 * Operator-controlled resizable split between two adjacent panels (#854,
 * decision record section 3 "Resize": "only where operator-controlled
 * resizing is actually needed ... via one focused split/resize dependency
 * rather than a general drag-and-drop framework"). `react-resizable-panels`
 * (MIT) is that one dependency — its `Separator` ships its own
 * `role="separator"` and keyboard support (arrow keys resize once the
 * separator has focus), so this wrapper only supplies WivWav sizing/visual
 * styling, not accessibility behavior from scratch.
 */
export function WorkspaceResizableSplit({
  label,
  first,
  second,
  defaultFirstSize = 50,
  orientation = 'horizontal',
}: WorkspaceResizableSplitProps) {
  return (
    <Group orientation={orientation} className={styles.group} aria-label={label}>
      <Panel defaultSize={defaultFirstSize} minSize="20" className={styles.pane}>
        {first}
      </Panel>
      <Separator className={styles.separator} aria-label={`Resize ${label}`} />
      <Panel minSize="20" className={styles.pane}>
        {second}
      </Panel>
    </Group>
  )
}
