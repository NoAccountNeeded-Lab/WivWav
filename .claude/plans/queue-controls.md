# Plan: queue and worker controls (ops web app)

Goal: from ops (browser), see the queue and control it; workers stay dumb. A menu-bar worker app comes later and only calls these same admin endpoints. Status 2026-10-16.

## Survey facts (from code survey; verify before relying)
- BullMQ ^6.3.11, 25 queues (packages/queue/src/queues.ts). Enqueue: schedules (schedule-registration.ts), POST /admin/sources/:id/run (admin.ts ~250), POST /admin/queues/:name/jobs (admin.ts ~183).
- Dispatch is PUSH over WebSocket: BullMQ processor (gateway-workers.ts) -> WorkerDispatcher.dispatch (dispatcher.ts ~76) -> registry.pickWorker (registry.ts ~150, least-loaded, filters chromium/httpEnrich capability and maxConcurrentJobs). No match -> RetryJobSignal 15 s. Per-source lock: 1 in-flight job per sourceId.
- Existing controls: queue pause/resume, delete all failed (admin.ts ~207-229). GET /admin/workers (admin-workers.ts). Ops pages: queues, workers, runs, schedules, sources exist.
- Gaps: no per-job cancel/retry/promote/priority; no worker pause; no job-to-worker pinning.
- BullMQ Job has changePriority, promote, retry, remove (confirmed in installed d.ts).

## Codex review (2026-10-16) - plan revised
- Run-next/priority DROPPED: BullMQ serves ordinary waiting jobs before prioritized (moveToActive-11.lua:74); prioritized state is also invisible in ops (types.ts:26, queue-adapter.ts:45, admin.ts:178). Revisit with Redis-backed ordering tests.
- Pinning DEFERRED: RetryJobSignal rate-limits the whole queue (factory.ts:75), so an unavailable pin would stall unrelated jobs; worker ids are untrusted/non-unique (registry.ts:4).
- Cancel = remove QUEUED attempt only (never stops a remote worker; dispatcher.ts:205/226). Active job -> 409.
- New mutations MUST mount inside the /internal/ops guarded scope (app.ts:406-411; admin-auth.ts:24); test missing/wrong bearer and BFF origin.
- GET /admin/workers omits connectionId (admin-workers.ts:133): expose it. Pause = stop new selection; in-flight drain.
- Add narrow adapter ops in packages/queue (types.ts:82); retry budget: choose explicitly (reset attempts or not); 409 on lock/state races; Redis integration tests (waiting/delayed/active/failed/paused/missing).
- Survey correction: 23 queues, 12 gateway-dispatched; Bull Board already exists (board.ts:4).

## Units (one issue + worktree + PR each)
| # | Unit | Notes |
|---|------|-------|
| U1 | Worker pause/resume | `accepting` flag on RegisteredWorker; pickWorker skips non-accepting; in-flight drain. Expose connectionId in GET workers. POST pause/resume inside guarded scope; 404 stale connection; resets to accepting on reconnect. Pause/Resume icon button on WorkerCard. Tests: pause-before-dispatch, dispatch-before-pause, reconnect reset, stale 404, auth. |
| U2 | Queued-job controls | Adapter ops: removeQueued, retryFailed, makeReady(promote delayed). Routes POST /queues/:name/jobs/:id/{cancel,retry,make-ready}; 409 on active/lock/state race, 404 missing. Ops queue-detail icon buttons. Redis integration tests. |

Out of scope: run-next/priority, pin-to-worker, stale-source alerting, Meilisearch poller noise, Swift app.

## Order
U1 and U2 in parallel (disjoint files).
