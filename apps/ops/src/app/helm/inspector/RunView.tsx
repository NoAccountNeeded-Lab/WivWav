'use client'

import { RelativeTimestamp } from '@/lib/relative-time'
import { useHelm } from '../helm-context'
import { Notice } from '../primitives'
import { parseRunRef } from '../helm-url'
import { findParentNode, findRunNode } from './EvidenceLists'
import { SourceEvidenceGroups } from './EvidenceGroups'
import { Facts, InspectorSection, TechnicalDetails } from './InspectorSections'
import { SourceActions } from './SourceActions'
import { useSourceScope } from './SourceEvidenceScope'
import { formatRunCount, jobRunStatusLabel } from '../../ops/sources/[id]/source-job-run-helpers'
import type { RunRow } from '../../ops/overview-helpers'
import type { JobRunNode } from '../../ops/sources/[id]/source-job-run-helpers'
import styles from './helm-inspector.module.css'

export type SelectedRun =
  | { kind: 'scrape'; run: RunRow }
  | { kind: 'job'; node: JobRunNode; parent: JobRunNode | null }
  | { kind: 'missing'; reason: string }

export function useSelectedRun(): SelectedRun | null {
  const { data, nav } = useHelm()
  const scope = useSourceScope()
  const ref = parseRunRef(nav.location.selection.run)
  if (!ref) return null
  if (ref.kind === 'scrape') {
    const run = data.resources.runs.data?.find(row => row.id === ref.id)
    if (run) return { kind: 'scrape', run }
    return { kind: 'missing', reason: data.resources.runs.data === null ? 'Scrape runs are unavailable.' : 'This scrape run is no longer in the latest 100 runs.' }
  }
  const tree = scope?.evidence.runTree.data
  if (!tree) return { kind: 'missing', reason: scope ? 'The run tree is unavailable.' : 'Select a source to load its run tree.' }
  const node = findRunNode(tree.runs, ref.id)
  return node ? { kind: 'job', node, parent: findParentNode(tree.runs, ref.id) } : { kind: 'missing', reason: 'This run is not in the source’s run tree.' }
}

export function runLabel(selected: SelectedRun | null): string {
  if (!selected || selected.kind === 'missing') return 'Run'
  if (selected.kind === 'scrape') return `${selected.run.sourceName ?? selected.run.sourceId} scrape`
  return selected.node.jobType
}

export function RunView() {
  const selected = useSelectedRun()
  if (!selected) return null

  if (selected.kind === 'missing') {
    return (
      <>
        <InspectorSection title="What happened"><Notice tone="warning">{selected.reason}</Notice></InspectorSection>
        <InspectorSection title="Impact"><p className={styles.prose}>Impact unknown: the run is not loaded.</p></InspectorSection>
      </>
    )
  }

  if (selected.kind === 'scrape') {
    const { run } = selected
    const state = run.success === true ? 'succeeded' : run.success === false ? 'failed' : run.finishedAt === null ? 'is still running' : 'finished with an unknown result'
    return (
      <>
        <InspectorSection title="What happened">
          <p className={styles.prose}>The scrape run for {run.sourceName ?? run.sourceId} {state}.</p>
          <Facts
            items={[
              ['Started', <RelativeTimestamp key="s" value={run.startedAt} />],
              ['Finished', <RelativeTimestamp key="f" value={run.finishedAt} fallback="not finished" />],
              ['Listings found', run.listingsFound === null ? 'not reported' : run.listingsFound.toLocaleString()],
              ['New / updated', `${run.listingsNew ?? '—'} / ${run.listingsUpdated ?? '—'}`],
              ...(run.errorMessage ? [['Error', run.errorMessage] as const] : []),
            ]}
          />
        </InspectorSection>
        <InspectorSection title="Impact">
          <p className={styles.prose}>
            {run.success === false
              ? 'This run did not refresh listings for the source. Earlier listings stay as they were.'
              : run.success === true
                ? 'No impact from this run itself. A passing run does not by itself prove the source problem is resolved.'
                : 'Impact unknown: the run has no recorded result.'}
          </p>
        </InspectorSection>
        <InspectorSection title="Evidence"><SourceEvidenceGroups /></InspectorSection>
        <InspectorSection title="Actions"><SourceActions sourceId={run.sourceId} /></InspectorSection>
      </>
    )
  }

  const { node, parent } = selected
  return (
    <>
      <InspectorSection title="What happened">
        <p className={styles.prose}>{node.jobType} run: {jobRunStatusLabel(node.status).toLowerCase()}.</p>
        <Facts
          items={[
            ['Started', <RelativeTimestamp key="s" value={node.startedAt} />],
            ['Finished', <RelativeTimestamp key="f" value={node.finishedAt} fallback="not finished" />],
            ['Succeeded / failed', `${formatRunCount(node.succeededCount)} / ${formatRunCount(node.failedCount)}`],
            ['Spawned by', parent ? parent.jobType : 'nothing (a root run)'],
            ['Spawned runs', node.children.length.toLocaleString()],
            ...(node.errorMessage ? [['Error', node.errorMessage] as const] : []),
          ]}
        />
      </InspectorSection>
      <InspectorSection title="Impact">
        <p className={styles.prose}>
          {node.status === 'failed'
            ? `Work done by this ${node.jobType} run did not complete; anything downstream of it in the tree may be missing updates.`
            : 'Impact unknown: run records do not state what changed for listings.'}
        </p>
      </InspectorSection>
      <InspectorSection title="Evidence">
        <SourceEvidenceGroups />
        <TechnicalDetails><pre className={styles.pre}>{JSON.stringify({ ...node, children: node.children.map(child => child.id) }, null, 2)}</pre></TechnicalDetails>
      </InspectorSection>
      <InspectorSection title="Actions"><SourceActions sourceId={node.sourceId} /></InspectorSection>
    </>
  )
}
