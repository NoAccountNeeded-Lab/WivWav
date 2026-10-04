'use client'

import type { ReactNode } from 'react'
import { resourceFreshness, type FreshnessInput } from '../helm-freshness'
import { HELM_REFRESH_MS } from '../use-helm-data'
import { FreshnessChip } from '../primitives'
import { useHelm } from '../helm-context'
import { Notice } from '../primitives'
import { PipelineStageList, RunTree, LogList } from './EvidenceLists'
import { useSourceScope } from './SourceEvidenceScope'
import styles from './helm-inspector.module.css'

function Group({ title, resource, defaultOpen, children }: {
  title: string
  resource: FreshnessInput & { error: string | null }
  defaultOpen?: boolean
  children: ReactNode
}) {
  const { data } = useHelm()
  const freshness = resourceFreshness(resource, data.nowMs, HELM_REFRESH_MS)
  return (
    <details className={styles.evidenceGroup} {...(defaultOpen ? { open: true } : {})}>
      <summary>{title}</summary>
      <p className={styles.reason}><FreshnessChip freshness={freshness} /></p>
      {resource.data === null ? (
        <Notice tone="warning">{title} unavailable{resource.error ? ` (${resource.error})` : ''}. Absence of data is not a sign everything is fine.</Notice>
      ) : children}
    </details>
  )
}

/** Expandable evidence areas for the selected source: pipeline, run tree (lineage) and logs. */
export function SourceEvidenceGroups() {
  const scope = useSourceScope()
  const { nav } = useHelm()
  if (!scope) return null
  const { pipeline, runTree, logs } = scope.evidence
  const selection = nav.location.selection
  return (
    <div className={styles.frameBody}>
      <Group title="Source pipeline" resource={pipeline} defaultOpen>
        {pipeline.data && <PipelineStageList stages={pipeline.data.stages} />}
      </Group>
      <Group title="Run tree" resource={runTree}>
        {runTree.data && <RunTree runs={runTree.data.runs} selectedRef={selection.run} onSelect={ref => nav.openRun(ref, scope.sourceId)} />}
      </Group>
      <Group title="Recent logs" resource={logs}>
        {logs.data && <LogList entries={logs.data.entries} selectedKey={selection.log} onSelect={nav.openLog} />}
      </Group>
    </div>
  )
}
