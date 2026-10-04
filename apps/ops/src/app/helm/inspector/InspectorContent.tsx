'use client'

import { useHelm } from '../helm-context'
import type { HelmFocusKind } from '../helm-url'
import { InspectorFrame, type Crumb } from './InspectorFrame'
import { LogView } from './LogView'
import { ProblemView, problemTitle, useSelectedProblem } from './ProblemView'
import { RunView, runLabel, useSelectedRun } from './RunView'
import { SourceEvidenceScope } from './SourceEvidenceScope'
import { SourceView, useSelectedSource } from './SourceView'

export const INSPECTOR_TITLE_ID = 'helm-inspector-title'

const VIEWS: Record<HelmFocusKind, () => React.ReactNode> = {
  problem: () => <ProblemView />,
  source: () => <SourceView />,
  run: () => <RunView />,
  log: () => <LogView />,
}

function Body({ onClose }: { onClose: () => void }) {
  const { nav } = useHelm()
  const selection = nav.location.selection
  const { fingerprint, brief } = useSelectedProblem()
  const { sourceId, source } = useSelectedSource()
  const run = useSelectedRun()
  const focus = selection.focus
  if (focus === null) return null

  const labels: Record<HelmFocusKind, string> = {
    problem: fingerprint ? problemTitle(fingerprint, brief) : '',
    source: source?.name ?? (sourceId ? `Source ${sourceId}` : ''),
    run: runLabel(run),
    log: 'Log line',
  }
  const crumbs: Crumb[] = (['problem', 'source', 'run', 'log'] as const)
    .filter(kind => selection[kind] !== null)
    .map(kind => ({ kind, label: labels[kind] }))

  return (
    <InspectorFrame titleId={INSPECTOR_TITLE_ID} title={labels[focus]} crumbs={crumbs} focus={focus} onClose={onClose}>
      {VIEWS[focus]()}
    </InspectorFrame>
  )
}

/** Contextual inspector body for the current selection chain. Renders once; the host decides where it lives. */
export function InspectorContent({ onClose }: { onClose: () => void }) {
  const { nav } = useHelm()
  return (
    <SourceEvidenceScope sourceId={nav.location.selection.source}>
      <Body onClose={onClose} />
    </SourceEvidenceScope>
  )
}
