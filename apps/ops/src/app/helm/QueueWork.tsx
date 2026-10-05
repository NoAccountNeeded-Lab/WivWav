'use client'

import { useMemo, useState } from 'react'
import { StackedBarList, type StackedBarRow, type StackedBarSeries } from '@wivwav/charts'
import type { QueueRow } from '../ops/overview-helpers'
import type { Freshness } from './helm-freshness'
import { buildQueueWork, waitingRunningText, type StageWork } from './queue-work-model'
import { ViewSwitch } from './ViewSwitch'
import { ScrollRegion } from './ScrollRegion'
import styles from './helm-sections.module.css'

type QueueView = 'queue' | 'stage'

const VIEWS = [
  { id: 'queue', label: 'By queue', question: 'Which queue has work waiting?' },
  { id: 'stage', label: 'By stage', question: 'Which part of the pipeline has work waiting?' },
] as const

/** Waiting is the lighter fill, running the solid one; exact numbers are also written beside every bar. */
const SERIES: StackedBarSeries[] = [
  { key: 'waiting', label: 'Waiting (queued, not started)', fill: 'color-mix(in srgb, var(--clr-primary) 30%, var(--clr-surface))', stroke: 'var(--clr-primary)' },
  { key: 'running', label: 'Running (a worker has it)', fill: 'var(--clr-primary)' },
]

function stageValueText(stage: StageWork): string {
  const partial = stage.missingQueues.length > 0
  return `${partial ? 'at least ' : ''}${waitingRunningText(stage)}${partial ? ` · ${stage.missingQueues.length} queue${stage.missingQueues.length === 1 ? '' : 's'} not reported` : ''}`
}

interface QueueWorkProps {
  queues: QueueRow[] | null
  freshness: Freshness
  asOf: Date | null
}

/**
 * Answers "where is work waiting right now, and is a worker on it?".
 * Delayed jobs are shown as a separate count, never added to waiting: the API
 * cannot say whether they are scheduled or retrying, and carries no job age,
 * so nothing here claims work is stuck. No queue history is recorded.
 */
export function QueueWork({ queues, freshness, asOf }: QueueWorkProps) {
  const [view, setView] = useState<QueueView>('queue')
  const model = useMemo(() => buildQueueWork(queues), [queues])
  const heading = 'Work in the queues right now'

  if (model === null) {
    return (
      <div className={styles.chartBlock}>
        <h3 className={styles.chartTitle}>{heading}</h3>
        <p className={styles.empty}>Queue data is unavailable, so what is waiting is unknown (not zero).</p>
      </div>
    )
  }

  const { totals } = model
  const time = asOf ? asOf.toLocaleTimeString() : 'an unknown time'
  const active = VIEWS.find(item => item.id === view) ?? VIEWS[0]
  const rows: StackedBarRow[] = view === 'queue'
    ? model.busy.map(row => ({ key: row.queue, label: row.label, values: { waiting: row.waiting, running: row.running }, valueText: `${waitingRunningText(row)}${row.paused ? ' · paused' : ''}` }))
    : model.stages.map(stage => ({ key: stage.id, label: stage.label, values: { waiting: stage.waiting, running: stage.running }, valueText: stageValueText(stage) }))
  const chartName = `${heading}, ${active.label.toLowerCase()}`
  const idleQueues = model.rows.length - model.busy.length - model.delayedOnly.length

  return (
    <div className={styles.chartBlock}>
      <h3 className={styles.chartTitle}>{heading}</h3>
      <p className={styles.note}>
        Jobs counted now, as of {time}{freshness === 'stale' ? ' (last successful reading; the latest refresh failed)' : ''}. No queue history is recorded, so this cannot show whether work is growing or how long it has waited.
      </p>
      <p className={styles.queueSummary} role="status">
        <strong>{totals.waiting.toLocaleString()} waiting</strong> and <strong>{totals.running.toLocaleString()} running</strong> across {model.busy.length.toLocaleString()} of {model.rows.length.toLocaleString()} queues.
        {totals.delayed > 0 && <> {totals.delayed.toLocaleString()} delayed {totals.delayed === 1 ? 'job is' : 'jobs are'} held for later (scheduled or retrying; the API does not say which) and not counted as waiting.</>}
        {totals.waiting + totals.running === 0 && ' Nothing is waiting or running.'}
      </p>

      <ViewSwitch label="Queue chart view" views={VIEWS} value={view} onChange={next => setView(next as QueueView)} />
      <p className={styles.note}>{active.question}</p>

      {rows.length === 0 || (view === 'queue' && model.busy.length === 0) ? (
        <p className={styles.empty}>No queue has work waiting or running.</p>
      ) : (
        <div className={styles.chartFrame}>
          <StackedBarList rows={rows} series={SERIES} unit="jobs" aria-label={`${chartName}. ${totals.waiting} waiting and ${totals.running} running.`} />
        </div>
      )}

      {view === 'queue' && (model.delayedOnly.length > 0 || idleQueues > 0) && (
        <p className={styles.note}>
          Not drawn: {model.delayedOnly.length > 0 && `${model.delayedOnly.length.toLocaleString()} queue${model.delayedOnly.length === 1 ? ' has' : 's have'} only delayed jobs`}
          {model.delayedOnly.length > 0 && idleQueues > 0 && '; '}
          {idleQueues > 0 && `${idleQueues.toLocaleString()} ${idleQueues === 1 ? 'is' : 'are'} empty`}. Every queue is listed in Queue details.
        </p>
      )}

      <details className={styles.definition}>
        <summary>Queue details ({model.rows.length.toLocaleString()} queues)</summary>
        <ScrollRegion label="Queue details table">
          <table className={styles.dataTable}>
            <caption>Current jobs per queue, as of {time}. Failed is the retained failed-job count, not a rate.</caption>
            <thead>
              <tr>
                <th scope="col">Queue</th><th scope="col">Stage</th><th scope="col">Waiting</th><th scope="col">Running</th><th scope="col">Delayed</th><th scope="col">Failed (retained)</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map(row => (
                <tr key={row.queue}>
                  <th scope="row">{row.label}{row.label !== row.queue && <span className={styles.cardMeta}> {row.queue}</span>}{row.paused && ' (paused)'}</th>
                  <td>{model.stages.find(stage => stage.id === row.stageId)?.label ?? ''}</td>
                  <td data-numeric="true">{row.waiting.toLocaleString()}</td>
                  <td data-numeric="true">{row.running.toLocaleString()}</td>
                  <td data-numeric="true">{row.delayed.toLocaleString()}</td>
                  <td data-numeric="true">{row.failed.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>All queues</th>
                <td data-numeric="true">{totals.waiting.toLocaleString()}</td>
                <td data-numeric="true">{totals.running.toLocaleString()}</td>
                <td data-numeric="true">{totals.delayed.toLocaleString()}</td>
                <td data-numeric="true">{totals.failed.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </ScrollRegion>
      </details>
    </div>
  )
}
