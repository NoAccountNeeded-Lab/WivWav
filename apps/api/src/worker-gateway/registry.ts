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
  lastHeartbeatAt: Date
  send(message: CoordinatorToWorkerMessage): void
}

/**
 * In-memory registry of connected workers plus the per-source concurrency
 * gate (#948 phase 1: at most one in-flight job per sourceId across all
 * gateway queues — scraping one source from several machines in parallel is
 * how you get rate-limited or banned).
 */
export class WorkerRegistry {
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

  list(): RegisteredWorker[] {
    return [...this.workers.values()]
  }

  /**
   * Least-loaded connected worker that matches the capability requirement
   * and has spare concurrency, or undefined when none qualifies.
   */
  pickWorker(requirements: { chromium: boolean }): RegisteredWorker | undefined {
    let best: RegisteredWorker | undefined
    for (const worker of this.workers.values()) {
      if (requirements.chromium && !worker.capabilities.chromium) continue
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
