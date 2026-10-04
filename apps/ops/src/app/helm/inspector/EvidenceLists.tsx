'use client'

import { OpsStatusChip } from '@/components/OpsStatusChip'
import { RelativeTimestamp } from '@/lib/relative-time'
import type { PipelineStage } from '../../ops/sources/[id]/source-pipeline-helpers'
import { stageStatus, stageStatusLabel } from '../../ops/sources/[id]/source-pipeline-helpers'
import { formatRunCount, jobRunStatusLabel, jobRunStatusVariant, type JobRunNode } from '../../ops/sources/[id]/source-job-run-helpers'
import { logKey } from '../helm-url'
import type { HelmLogEntry } from '../use-source-evidence'
import styles from './helm-inspector.module.css'

export function PipelineStageList({ stages }: { stages: PipelineStage[] }) {
  if (stages.length === 0) return <p className={styles.reason}>The pipeline reported no stages for this source.</p>
  return (
    <ul className={styles.list} aria-label="Pipeline stages for this source">
      {stages.map(stage => {
        const status = stageStatus(stage)
        return (
          <li key={stage.stage} className={styles.listItem}>
            <span className={styles.prose}>
              <strong>{stage.stage}</strong>{' '}
              <OpsStatusChip variant={status === 'failed' ? 'danger' : status === 'stalled' ? 'warning' : 'neutral'} label={stageStatusLabel(stage)} />
            </span>
            <span className={styles.reason}>
              {stage.pendingCount.toLocaleString()} pending · {stage.failedCount.toLocaleString()} failed
              {stage.failedScopedToSource ? '' : ' (failures are not scoped to this source)'}
              {' · last completed '}<RelativeTimestamp value={stage.lastCompletedAt} fallback="never" />
            </span>
          </li>
        )
      })}
    </ul>
  )
}

interface RunTreeProps {
  runs: JobRunNode[]
  selectedRef: string | null
  onSelect: (ref: string) => void
}

function RunTreeNodes({ runs, selectedRef, onSelect }: RunTreeProps) {
  return (
    <>
      {runs.map(node => {
        const ref = `job:${node.id}`
        return (
          <li key={node.id} className={styles.listItem}>
            <button type="button" className={styles.listButton} aria-current={selectedRef === ref ? 'true' : undefined} onClick={() => onSelect(ref)}>
              <strong>{node.jobType}</strong>
              <OpsStatusChip variant={jobRunStatusVariant(node.status)} label={jobRunStatusLabel(node.status)} />
              <span>started <RelativeTimestamp value={node.startedAt} /></span>
              <span>ok {formatRunCount(node.succeededCount)} · failed {formatRunCount(node.failedCount)}</span>
            </button>
            {node.children.length > 0 && (
              <ul className={styles.nested} aria-label={`Runs spawned by ${node.jobType}`}>
                <RunTreeNodes runs={node.children} selectedRef={selectedRef} onSelect={onSelect} />
              </ul>
            )}
          </li>
        )
      })}
    </>
  )
}

/** Actual lineage: each run is nested under the run that spawned it (not inferred from stage order). */
export function RunTree(props: RunTreeProps) {
  if (props.runs.length === 0) return <p className={styles.reason}>No pipeline runs are recorded for this source.</p>
  return (
    <ul className={styles.list} aria-label="Run tree (actual lineage)">
      <RunTreeNodes {...props} />
    </ul>
  )
}

export function findRunNode(runs: JobRunNode[], id: string): JobRunNode | null {
  for (const node of runs) {
    if (node.id === id) return node
    const inChild = findRunNode(node.children, id)
    if (inChild) return inChild
  }
  return null
}

export function findParentNode(runs: JobRunNode[], id: string, parent: JobRunNode | null = null): JobRunNode | null {
  for (const node of runs) {
    if (node.id === id) return parent
    const found = findParentNode(node.children, id, node)
    if (found) return found
  }
  return null
}

interface LogListProps {
  entries: HelmLogEntry[]
  selectedKey: string | null
  onSelect: (key: string) => void
}

export function LogList({ entries, selectedKey, onSelect }: LogListProps) {
  if (entries.length === 0) return <p className={styles.reason}>No log lines mention this source in the last hour.</p>
  return (
    <ul className={styles.list} aria-label="Recent log lines for this source">
      {entries.slice(0, 40).map(entry => {
        const key = logKey(entry)
        return (
          <li key={key + (entry.message ?? '')} className={styles.listItem}>
            <button type="button" className={styles.listButton} aria-current={selectedKey === key ? 'true' : undefined} onClick={() => onSelect(key)}>
              <strong>{entry.level ?? 'log'}</strong>
              <span>{entry.service ?? 'unknown service'}</span>
              <span><RelativeTimestamp value={entry.ts} /></span>
              <span>{truncate(entry.message ?? '(no message)', 120)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
