import Link from 'next/link'
import { Activity, CheckCircle2, Gauge, Server, Timer } from 'lucide-react'
import css from './WorkersClient.module.css'
import { fmtDuration, type QueueSummary, type WorkersSummary } from './workers-data'

const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`)

export function FleetSummary({ summary, busy, idle, stale }: { summary: WorkersSummary; busy: number; idle: number; stale: number }) {
  const util = summary.capacity > 0 ? Math.round((summary.inFlight / summary.capacity) * 100) : 0
  const slowest = summary.queues
    .filter((q) => q.avgDurationMs !== null)
    .reduce<QueueSummary | undefined>((a, q) => (!a || (q.avgDurationMs ?? 0) > (a.avgDurationMs ?? 0) ? q : a), undefined)
  return (
    <section aria-label="Fleet summary" className={css.stats}>
      <div className={css.stat}>
        <div className={css.statLabel}><Server size={16} aria-hidden="true" />Workers</div>
        <div className={css.statValue}>{summary.workers}</div>
        <div className={css.statSub}>{busy} busy · {idle} idle · {stale} stale</div>
      </div>
      <div className={css.stat}>
        <div className={css.statLabel}><Gauge size={16} aria-hidden="true" />Capacity in use</div>
        <div className={css.statValue}>{summary.inFlight}<span className={css.unit}> / {summary.capacity} slots</span></div>
        <div className={css.bar} role="img" aria-label={`${util}% of job slots in use`}>
          <div className={css.barFill} style={{ width: `${util}%` }} />
        </div>
      </div>
      <div className={css.stat}>
        <div className={css.statLabel}><Activity size={16} aria-hidden="true" />Throughput</div>
        <div className={css.statValue}>
          {summary.jobsPerMinute === null ? '—' : summary.jobsPerMinute.toFixed(1)}<span className={css.unit}> jobs/min</span>
        </div>
        <div className={css.statSub}>{summary.completed + summary.failed} jobs settled</div>
      </div>
      <div className={css.stat}>
        <div className={css.statLabel}><CheckCircle2 size={16} aria-hidden="true" />Success rate</div>
        <div className={css.statValue}>{pct(summary.successRate)}</div>
        <div className={css.statSub}>
          <span data-bad={summary.failed > 0}>{summary.failed} failed</span> · <span>{summary.escalated} escalated</span>
        </div>
      </div>
      <div className={css.stat}>
        <div className={css.statLabel}><Timer size={16} aria-hidden="true" />Avg job duration</div>
        <div className={css.statValue}>{fmtDuration(summary.avgDurationMs)}</div>
        <div className={css.statSub}>
          {slowest ? <>Slowest queue: {slowest.queueName} <span className={css.mono}>{fmtDuration(slowest.avgDurationMs)}</span></> : 'No jobs settled yet'}
        </div>
      </div>
    </section>
  )
}

export function QueueTable({ queues }: { queues: QueueSummary[] }) {
  const max = Math.max(1, ...queues.map((q) => q.completed))
  return (
    <section aria-labelledby="wd-queues" className={css.queues}>
      <h2 id="wd-queues" className={css.h2}>By queue</h2>
      {queues.length === 0 ? (
        <p className={css.muted}>No jobs have run yet.</p>
      ) : (
        <div className={css.queueWrap}>
          <table className={css.queueTable} aria-labelledby="wd-queues">
            <thead>
              <tr>
                <th scope="col">Queue</th>
                <th scope="col" className={css.num}>Running</th>
                <th scope="col" className={css.num}>Done</th>
                <th scope="col" className={css.num}>Failed</th>
                <th scope="col" className={css.num}>Avg</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => (
                <tr key={q.queueName}>
                  <td>
                    <Link className={`${css.mono} ${css.queueLink}`} href="/ops/queues" title="Open in Queues">{q.queueName}</Link>
                    <span className={css.share}><span style={{ width: `${Math.round((q.completed / max) * 100)}%` }} /></span>
                  </td>
                  <td className={`${css.mono} ${css.num}`}>{q.running}</td>
                  <td className={`${css.mono} ${css.num}`}>{q.completed}</td>
                  <td className={`${css.mono} ${css.num}`} data-bad={q.failed > 0}>{q.failed}</td>
                  <td className={`${css.mono} ${css.num}`}>{fmtDuration(q.avgDurationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
