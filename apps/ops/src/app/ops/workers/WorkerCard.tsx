import Link from 'next/link'
import { Globe, Zap, ChevronRight } from 'lucide-react'
import css from './WorkersClient.module.css'
import {
  fmtDuration,
  fmtElapsed,
  logsHref,
  STALE_HEARTBEAT_MS,
  type ConnectedWorker,
  type RecentJob,
} from './workers-data'

type Pip = 'ok' | 'fail' | 'esc'

function pipKind(job: RecentJob): Pip {
  return job.escalated ? 'esc' : job.success ? 'ok' : 'fail'
}

const PIP_LABEL: Record<Pip, string> = { ok: 'Succeeded', fail: 'Failed', esc: 'Escalated (requeued)' }

function pipLabel(job: RecentJob): string {
  const kind = pipKind(job)
  const detail = kind !== 'ok' && job.errorMessage ? `: ${job.errorMessage}` : ''
  return `${PIP_LABEL[kind]}${detail} — ${job.queueName}, open log trail`
}

export function workerStatus(worker: ConnectedWorker, now: number): 'busy' | 'idle' | 'stale' {
  if (now - Date.parse(worker.lastHeartbeatAt) > STALE_HEARTBEAT_MS) return 'stale'
  return worker.inFlightCount > 0 ? 'busy' : 'idle'
}

const STATUS_LABEL = { busy: 'Busy', idle: 'Idle', stale: 'Heartbeat overdue' } as const

export function WorkerCard({ worker, now }: { worker: ConnectedWorker; now: number }) {
  const status = workerStatus(worker, now)
  const settled = worker.completed + worker.failed
  const avg = settled > 0 ? worker.totalDurationMs / settled : null
  const hb = Math.max(0, Math.round((now - Date.parse(worker.lastHeartbeatAt)) / 1000))
  const max = worker.capabilities.maxConcurrentJobs
  const slots = Array.from({ length: max }, (_, i) => i < worker.inFlightCount)

  return (
    <article className={css.card} data-status={status}>
      <div className={css.cardHead}>
        <span className={css.dot} data-status={status} aria-hidden="true" />
        <div className={css.cardTitle}>
          <Link className={css.workerLink} href={logsHref(worker.workerName)} title="Open this worker's logs">
            {worker.workerName}
          </Link>
          <span className={css.status} data-status={status}>{STATUS_LABEL[status]}</span>
        </div>
        {worker.capabilities.chromium ? (
          <span className={css.cap} title="Chromium"><Globe size={16} aria-hidden="true" /><span className="sr-only">Chromium</span></span>
        ) : null}
        {worker.capabilities.httpEnrich ? (
          <span className={css.cap} title="HTTP enrich"><Zap size={16} aria-hidden="true" /><span className="sr-only">HTTP enrich</span></span>
        ) : null}
        <div className={css.slots} role="img" aria-label={`${worker.inFlightCount} of ${max} job slots in use`}>
          {slots.map((used, i) => <span key={i} className={css.slot} data-used={used} />)}
        </div>
      </div>

      <div className={css.jobs}>
        {worker.inFlightJobs.length > 0 ? (
          worker.inFlightJobs.map((job) => {
            const started = Date.parse(job.dispatchedAt)
            return (
              <Link key={job.correlationId} className={css.jobRow} href={logsHref(job.correlationId, started)} title="Open this job's log trail">
                <span className={css.liveDot} aria-hidden="true" />
                <span className={css.mono}>{job.queueName}</span>
                <span className={`${css.mono} ${css.muted} ${css.corr}`}>{job.correlationId}</span>
                <span className={css.mono} data-slow={now - started >= 60_000}>
                  <span className="sr-only">running for </span>{fmtElapsed(now - started)}
                </span>
                <ChevronRight size={14} aria-hidden="true" />
              </Link>
            )
          })
        ) : (
          <div className={css.emptyJob}>
            {status === 'stale' ? `No heartbeat for ${hb}s — not taking work` : 'Idle — waiting for work'}
          </div>
        )}
      </div>

      <div className={css.cardFoot}>
        <span>
          <span className={css.mono}>{worker.completed}</span> done ·{' '}
          <span className={css.mono} data-bad={worker.failed > 0}>{worker.failed}</span> failed
          {worker.escalated > 0 ? <> · <span className={css.mono}>{worker.escalated}</span> escalated</> : null}
          {' '}· avg <span className={css.mono}>{fmtDuration(avg)}</span>
        </span>
        <ul className={css.pips} aria-label={`Last ${worker.recentJobs.length} jobs, newest first`}>
          {worker.recentJobs.map((job, i) => {
            const kind = pipKind(job)
            const label = pipLabel(job)
            const start = Date.parse(job.finishedAt) - (job.durationMs ?? 0)
            return (
              <li key={`${job.correlationId}-${job.finishedAt}-${i}`}>
                <Link className={css.pip} data-kind={kind} href={logsHref(job.correlationId, start)} title={label} aria-label={label}>
                  <span aria-hidden="true">{kind === 'fail' ? '×' : ''}</span>
                </Link>
              </li>
            )
          })}
        </ul>
        <span>Heartbeat <span className={css.mono} data-bad={hb * 1000 > STALE_HEARTBEAT_MS}>{hb}s ago</span></span>
      </div>
    </article>
  )
}
