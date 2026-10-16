import type { CoordinatorToWorkerMessage, WorkerCapabilities } from '@wivwav/types/worker-protocol'

/**
 * One live, hello'd WS connection. `connectionId` (not the worker-supplied
 * `workerId`) keys the registry: a reconnecting worker briefly has two
 * sockets, and the worker-supplied id is untrusted input, never a map key.
 */
export interface RegisteredWorker {
  connectionId: string
  workerId: string
  workerName: string
  capabilities: WorkerCapabilities
  /** Correlation ids currently dispatched to this connection. */
  inFlight: Set<string>
  /**
   * Per-job detail for each in-flight correlation id. Kept beside `inFlight`
   * (rather than replacing it) so dispatch pick/load math keeps reading the
   * Set; `#1067` surfaces this map on GET /admin/workers.
   */
  jobs: Map<string, InFlightJobDetail>
  /**
   * Most recent settled outcomes for this connection, newest first, bounded
   * to MAX_RECENT_JOBS. Recorded for completions, refusals, and timeouts —
   * every settle path except a connection drop, whose registry entry (and
   * ops row) is already gone by the time the drop is processed.
   */
  recentJobs: RecentJobOutcome[]
  /** In-memory counters since this connection was registered (#1140). */
  stats: WorkerStats
  lastHeartbeatAt: Date
  /**
   * False while an operator has paused this connection: `pickWorker` skips it
   * but in-flight jobs finish normally. In-memory only; a reconnect is a new
   * connection that registers as accepting. Omitted = accepting.
   */
  accepting?: boolean
  send(message: CoordinatorToWorkerMessage): void
}

export interface InFlightJobDetail {
  queueName: string
  dispatchedAt: Date
}

export interface RecentJobOutcome {
  queueName: string
  correlationId: string
  success: boolean
  /**
   * Set for a capability escalation (#1043): the attempt did not complete,
   * but the job was requeued (not failed). Operators read this as "needs a
   * more capable worker", never as a job error.
   */
  escalated?: boolean
  errorMessage?: string
  /** `finishedAt - dispatchedAt`, when the dispatch time was known. */
  durationMs?: number
  finishedAt: Date
}

/** Settled-job counters; an escalated attempt is counted apart from failures and has no duration. */
export interface QueueStats {
  completed: number
  failed: number
  totalDurationMs: number
  /** completed + failed jobs whose duration was known; the divisor for averages. */
  timed: number
}

export interface FleetStats extends QueueStats {
  escalated: number
  queues: Map<string, QueueStats>
}

/** Per-connection counters; fleet-wide totals live on the registry and survive reconnects. */
export interface WorkerStats extends FleetStats {
  connectedAt: Date
}

export function newFleetStats(): FleetStats {
  return { completed: 0, failed: 0, escalated: 0, totalDurationMs: 0, timed: 0, queues: new Map() }
}

/** Record one settled job into a stats bucket. An escalation is counted apart and never timed. */
export function recordOutcome(
  stats: FleetStats,
  queueName: string,
  kind: 'completed' | 'failed' | 'escalated',
  durationMs: number | undefined,
): void {
  if (kind === 'escalated') {
    stats.escalated++
    return
  }
  const q = stats.queues.get(queueName) ?? { completed: 0, failed: 0, totalDurationMs: 0, timed: 0 }
  stats.queues.set(queueName, q)
  for (const t of [stats, q]) {
    t[kind]++
    if (durationMs !== undefined) {
      t.totalDurationMs += durationMs
      t.timed++
    }
  }
}

export function newWorkerStats(connectedAt: Date = new Date()): WorkerStats {
  return { connectedAt, ...newFleetStats() }
}

/** Cap on per-worker outcome history — operators need the last few, not a log. */
export const MAX_RECENT_JOBS = 5

/**
 * In-memory registry of connected workers plus the per-source concurrency
 * gate (#948 phase 1: at most one in-flight job per sourceId across all
 * gateway queues — scraping one source from several machines in parallel is
 * how you get rate-limited or banned).
 */
export class WorkerRegistry {
  /** Fleet-wide totals since the API started; unlike per-worker stats they survive disconnects. */
  readonly fleet: FleetStats = newFleetStats()
  readonly startedAt = new Date()
  private readonly workers = new Map<string, RegisteredWorker>()
  private readonly sourceLocks = new Map<string, string>()

  register(worker: RegisteredWorker): void {
    this.workers.set(worker.connectionId, worker)
  }

  unregister(connectionId: string): RegisteredWorker | undefined {
    const worker = this.workers.get(connectionId)
    this.workers.delete(connectionId)
    return worker
  }

  get(connectionId: string): RegisteredWorker | undefined {
    return this.workers.get(connectionId)
  }

  recordHeartbeat(connectionId: string, at: Date): void {
    const worker = this.workers.get(connectionId)
    if (worker) worker.lastHeartbeatAt = at
  }

  /** Pause/resume new dispatches to one connection; false when the connection is gone. */
  setAccepting(connectionId: string, accepting: boolean): boolean {
    const worker = this.workers.get(connectionId)
    if (!worker) return false
    worker.accepting = accepting
    return true
  }

  list(): RegisteredWorker[] {
    return [...this.workers.values()]
  }

  /**
   * Least-loaded connected worker that matches the capability requirements
   * and has spare concurrency, or undefined when none qualifies. `chromium`
   * and `httpEnrich` (#962) are independent dimensions — a caller sets
   * whichever ones its job type needs; an omitted `httpEnrich` behaves as
   * `false` (no requirement), matching every job type dispatched before #962.
   */
  pickWorker(requirements: { chromium: boolean; httpEnrich?: boolean }): RegisteredWorker | undefined {
    let best: RegisteredWorker | undefined
    for (const worker of this.workers.values()) {
      if (worker.accepting === false) continue
      if (requirements.chromium && !worker.capabilities.chromium) continue
      if (requirements.httpEnrich && !worker.capabilities.httpEnrich) continue
      if (worker.inFlight.size >= worker.capabilities.maxConcurrentJobs) continue
      if (!best || worker.inFlight.size < best.inFlight.size) best = worker
    }
    return best
  }

  /** True when the source lock was acquired (or already held by this correlation). */
  tryAcquireSourceLock(sourceId: string, correlationId: string): boolean {
    const holder = this.sourceLocks.get(sourceId)
    if (holder !== undefined && holder !== correlationId) return false
    this.sourceLocks.set(sourceId, correlationId)
    return true
  }

  releaseSourceLock(sourceId: string, correlationId: string): void {
    if (this.sourceLocks.get(sourceId) === correlationId) {
      this.sourceLocks.delete(sourceId)
    }
  }
}
