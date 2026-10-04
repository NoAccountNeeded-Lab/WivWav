'use client'

import { useId } from 'react'
import { sourceControlState, type ControlState } from '../source-controls'
import { useHelm } from '../helm-context'
import type { ActionKind } from '../tracked-action'
import { ActionOutcomeList } from '../ActionOutcomeList'
import { useSourceScope } from './SourceEvidenceScope'
import styles from './helm-inspector.module.css'

interface SourceActionsProps {
  sourceId: string | null
  /** True for problems that are global (e.g. enrichment): source controls never apply. */
  global?: boolean
}

type SourceActionKind = Exclude<ActionKind, 'search-rebuild'>

const CONTROLS: ReadonlyArray<{ kind: SourceActionKind; label: string; hint: string; primary?: boolean }> = [
  { kind: 'source-run', label: 'Run source now', hint: 'Scrapes this source’s index pages now.', primary: true },
  { kind: 'detail-crawl', label: 'Run detail crawl', hint: 'Re-crawls listing detail pages for this source only.' },
  { kind: 'detail-extract', label: 'Run detail extraction', hint: 'Re-parses stored detail pages for this source only.' },
]

/**
 * Source-targeted recovery controls. They apply only to one identified,
 * executable source and are disabled — with the reason shown as text, and the
 * button still focusable — otherwise. Each press enqueues exactly one job
 * for the selected source and is tracked at the workspace level.
 */
export function SourceActions({ sourceId, global = false }: SourceActionsProps) {
  const { data, tracker } = useHelm()
  const scope = useSourceScope()
  const baseId = useId()
  const sources = data.resources.sources.data
  const base = sourceControlState(sourceId, sources, data.freshness.sources, global)
  const source = sourceId ? (sources?.find(row => row.id === sourceId) ?? null) : null
  const stages = scope?.evidence.pipeline.data?.stages ?? null

  function stateFor(kind: SourceActionKind): ControlState {
    if (!base.enabled) return base
    if (tracker.isBusy(kind, sourceId)) return { enabled: false, reason: 'This action is already queued or running for this source.' }
    return base
  }

  function press(kind: SourceActionKind) {
    if (!source || !stateFor(kind).enabled) return
    const target = { id: source.id, name: source.name }
    if (kind === 'source-run') void tracker.runSourceNow(target)
    else void tracker.runStage(kind, target, stages?.find(stage => stage.queue === kind) ?? null)
  }

  const related = tracker.actions.filter(action => sourceId !== null && action.sourceId === sourceId)

  return (
    <div className={styles.frameBody}>
      {CONTROLS.map(({ kind, label, hint, primary }) => {
        const state = stateFor(kind)
        const reasonId = `${baseId}-${kind}`
        return (
          <div key={kind} className={styles.listItem}>
            <button
              type="button"
              className={styles.actionButton}
              data-variant={primary ? 'primary' : undefined}
              aria-disabled={state.enabled ? undefined : 'true'}
              aria-describedby={reasonId}
              onClick={() => press(kind)}
            >
              {label}
            </button>
            <p id={reasonId} className={styles.reason}>{state.enabled ? hint : state.reason}</p>
          </div>
        )
      })}
      <ActionOutcomeList actions={related} label="Actions for this source" />
    </div>
  )
}
