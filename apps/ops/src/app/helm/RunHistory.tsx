'use client'

import { useState } from 'react'
import { ScrapeRunChart, StackedBarList, type StackedBarRow, type StackedBarSeries } from '@wivwav/charts'
import { OpsStatusChip } from '@/components/OpsStatusChip'
import { RelativeTimestamp } from '@/lib/relative-time'
import { ViewSwitch } from './ViewSwitch'
import { ScrollRegion } from './ScrollRegion'
import { listingsFoundText, runResult, sourceRunText, type RunHistoryModel } from './run-history-model'
import styles from './helm-sections.module.css'

type HistoryView = 'outcomes' | 'listings'

const VIEWS = [
  { id: 'outcomes', label: 'Outcomes by source', question: 'Which sources keep failing?' },
  { id: 'listings', label: 'Listings found per run', question: 'Is one source finding fewer listings than its earlier runs?' },
] as const

/** Danger vs primary passes the dataviz CVD check in the grafana dark and light themes; red-vs-green does not (deutan dE 1.3), so success is not green here. */
const SERIES: StackedBarSeries[] = [
  { key: 'failed', label: 'Failed', fill: 'var(--clr-danger)' },
  { key: 'succeeded', label: 'Succeeded', fill: 'var(--clr-primary)' },
  { key: 'unknown', label: 'No result recorded', fill: 'color-mix(in srgb, var(--clr-text-muted) 35%, var(--clr-surface))', stroke: 'var(--clr-text-muted)' },
]

const MAX_CHART_SOURCES = 12

const RESULT_LABEL = { failed: 'Failed', succeeded: 'Succeeded', unknown: 'No result' } as const
const RESULT_VARIANT = { failed: 'danger', succeeded: 'success', unknown: 'neutral' } as const

interface RunHistoryProps {
  history: RunHistoryModel | null
  error: string | null
  onInspectRun: (runId: string, sourceId: string) => void
}

/**
 * Past scrape results from the latest-runs list: one default view of which
 * sources are failing, and one alternate view of a single source's listings
 * found per run. Both use the same runs; neither draws a trend of inventory
 * or queue depth, because none is recorded.
 */
export function RunHistory({ history, error, onInspectRun }: RunHistoryProps) {
  const [view, setView] = useState<HistoryView>('outcomes')
  const [chosen, setChosen] = useState<string | null>(null)
  const heading = 'Recent scrape results'

  if (history === null) {
    return (
      <div className={styles.chartBlock}>
        <h3 className={styles.chartTitle}>{heading}</h3>
        <p className={styles.empty}>Scrape run history is unavailable{error ? ` (${error})` : ''}.</p>
      </div>
    )
  }
  if (history.total === 0) {
    return (
      <div className={styles.chartBlock}>
        <h3 className={styles.chartTitle}>{heading}</h3>
        <p className={styles.empty}>No scrape runs are recorded yet, so there is nothing to compare.</p>
      </div>
    )
  }

  const active = VIEWS.find(item => item.id === view) ?? VIEWS[0]
  const shown = history.sources.slice(0, MAX_CHART_SOURCES)
  const rows: StackedBarRow[] = shown.map(source => ({
    key: source.sourceId,
    label: source.name,
    values: { failed: source.failed, succeeded: source.succeeded, unknown: source.unknown },
    valueText: `${sourceRunText(source)} · latest ${RESULT_LABEL[runResult(source.latest)].toLowerCase()}`,
  }))
  const selected = history.sources.find(source => source.sourceId === chosen) ?? history.sources[0]!

  return (
    <div className={styles.chartBlock}>
      <h3 className={styles.chartTitle}>{heading}</h3>
      <p className={styles.note}>
        {history.windowLabel}. {history.failed.toLocaleString()} failed, {history.succeeded.toLocaleString()} succeeded
        {history.unknown > 0 && `, ${history.unknown.toLocaleString()} with no result recorded`}. Past results only: no queue or inventory history is recorded.
      </p>
      <ViewSwitch label="Scrape history view" views={VIEWS} value={view} onChange={next => setView(next as HistoryView)} />
      <p className={styles.note}>{active.question}</p>

      {view === 'outcomes' ? (
        <>
          <div className={styles.chartFrame}>
            <StackedBarList rows={rows} series={SERIES} unit="runs" aria-label={`${heading}, outcomes by source. ${history.windowLabel}.`} />
          </div>
          {history.sources.length > shown.length && (
            <p className={styles.note}>Showing the {shown.length} sources with the most failures; all {history.sources.length} are in Run details.</p>
          )}
        </>
      ) : (
        <>
          <label className={styles.selectLabel}>
            Source
            <select className={styles.select} value={selected.sourceId} onChange={event => setChosen(event.target.value)}>
              {history.sources.map(source => <option key={source.sourceId} value={source.sourceId}>{source.name}</option>)}
            </select>
          </label>
          <p className={styles.note}>
            {selected.name}: {selected.runs.length} run{selected.runs.length === 1 ? '' : 's'} in this window, oldest on the left. Bar height is listings found by that one run, not total inventory; failed runs often report 0.
          </p>
          <div className={styles.chartWide}>
            <ScrapeRunChart
              runs={selected.runs.map(run => ({ label: `${selected.name} ${new Date(run.startedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`, success: run.success, listingsFound: run.listingsFound }))}
              maxBars={selected.runs.length}
              ariaLabel={`Listings found per run for ${selected.name}. ${history.windowLabel}.`}
            />
          </div>
          <details className={styles.definition}>
            <summary>Numbers for {selected.name}</summary>
            <ScrollRegion label={`Runs of ${selected.name}`}>
              <table className={styles.dataTable}>
                <caption>Runs of {selected.name}, newest first</caption>
                <thead><tr><th scope="col">Started (UTC)</th><th scope="col">Result</th><th scope="col">Listings found</th></tr></thead>
                <tbody>
                  {[...selected.runs].reverse().map(run => (
                    <tr key={run.id}>
                      <th scope="row">{new Date(run.startedAt).toISOString().slice(0, 16).replace('T', ' ')}</th>
                      <td>{RESULT_LABEL[runResult(run)]}</td>
                      <td data-numeric="true">{listingsFoundText(run)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </details>
        </>
      )}

      <details className={styles.definition}>
        <summary>Run details by source ({history.sources.length.toLocaleString()} sources)</summary>
        <ScrollRegion label="Run details by source table">
          <table className={styles.dataTable}>
            <caption>{history.windowLabel}</caption>
            <thead>
              <tr><th scope="col">Source</th><th scope="col">Failed</th><th scope="col">Succeeded</th><th scope="col">No result</th><th scope="col">Latest run</th><th scope="col">Listings found</th><th scope="col">Action</th></tr>
            </thead>
            <tbody>
              {history.sources.map(source => {
                const result = runResult(source.latest)
                return (
                  <tr key={source.sourceId}>
                    <th scope="row">{source.name}</th>
                    <td data-numeric="true">{source.failed}</td>
                    <td data-numeric="true">{source.succeeded}</td>
                    <td data-numeric="true">{source.unknown}</td>
                    <td><OpsStatusChip variant={RESULT_VARIANT[result]} label={RESULT_LABEL[result]} /> <RelativeTimestamp value={source.latest.startedAt} /></td>
                    <td data-numeric="true">{listingsFoundText(source.latest)}</td>
                    <td>
                      <button type="button" className={styles.rowButton} aria-label={`Inspect latest run of ${source.name}`} onClick={() => onInspectRun(`scrape:${source.latest.id}`, source.sourceId)}>Inspect</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ScrollRegion>
      </details>
    </div>
  )
}
