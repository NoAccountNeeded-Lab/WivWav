# Worker fleet architecture

How `apps/api` (the coordinator) and `apps/worker` (a worker) distribute
scraping/enrichment jobs across however many workers are connected. For
*starting* a worker, see `docs/ops/client-worker.md` — this doc is the "how
does it actually work" reference so an agent or contributor doesn't have to
re-derive it from the source every time.

---

## Topology: who connects to whom

A worker dials **out** to the coordinator over WebSocket, at
`/internal/workers/ws` (`apps/worker/src/ws-client.ts`'s `toWsUrl`) — the
coordinator never opens a connection to a worker. This inversion is the
whole story for where a worker can run: anywhere with outbound network
access to the coordinator. Same host as the API, a separate cloud box, or
literally an operator's own laptop — `docs/ops/client-worker.md`'s "Remote
coordinator startup" (`make worker-remote` with `WORKER_COORDINATOR_URL` +
`WORKER_TOKEN`) is exactly that.

A worker is a plain Node.js process. It holds **no** direct credentials to
Postgres, Valkey, or Meilisearch — see the doc comment on `WorkerConfig` in
`apps/worker/src/config.ts` ("a worker never touches Postgres, Meilisearch,
or valkey"). Every read/write goes through authenticated HTTP calls back to
the coordinator's `/internal/scraper/*` and `/internal/workers/*` routes
(`apps/worker/src/scraper-gateway-client.ts`).

Docker is **not** architecturally required for a worker. `make
worker`/`make worker-remote` currently package it as the `job-runner`
service in `docker-compose.yml`, under an opt-in `worker` Compose profile —
that's the current deployment convenience, not a dependency of the worker
code itself. A standalone compiled binary (Node's built-in
single-executable-app support, or `pkg`) is a feasible alternative for a
"just run my app" distribution story; not built today.

## Job lifecycle

1. A job (`source-scrape`, `detail-crawl`, `detail-extract`, or one of the
   9 outbound-HTTP enrichment jobs — NHTSA recalls, VIN enrich, etc.) lands
   in a BullMQ queue, either via a source's `cronExpression`
   (`packages/types/src/source-registry.ts`) or an operator's "Run Now" in
   Ops.
2. `registerGatewayWorkers` (`apps/api/src/worker-gateway/gateway-workers.ts`)
   is the sole BullMQ consumer for every one of those queues. Its processor
   calls `WorkerDispatcher.dispatch()`
   (`apps/api/src/worker-gateway/dispatcher.ts`), which:
   - Picks an eligible connected worker via `WorkerRegistry.pickWorker()`
     (`apps/api/src/worker-gateway/registry.ts`) — the **least-loaded**
     worker (fewest jobs currently in flight) among those matching the
     job's capability requirements and with spare `maxConcurrentJobs`.
   - Sends a `job-dispatch` WebSocket message to that worker and awaits its
     HTTP completion callback (`POST /internal/workers/jobs/complete`,
     `workerJobCompleteRequestSchema` in `packages/types/src/worker-protocol.ts`)
     or a timeout.
   - If no eligible worker is connected, or the source's concurrency slot
     is already held (see "Per-source concurrency lock" below), the
     dispatch rejects with `RetryJobSignal` — the job goes back into the
     BullMQ queue (no attempt consumed) and is retried after
     `NO_WORKER_RETRY_DELAY_MS` (15s), not failed.
3. On the worker side, a `job-dispatch` message resolves to a handler (e.g.
   `apps/worker/src/handlers/source-scrape.ts` for `SOURCE_SCRAPE`), which
   resolves the matching source adapter
   (`packages/scraper-sources/src/sources/*.ts`, via the registry key) and
   runs it, then reports the result back over HTTP.

## Capability escalation (#1043)

A `SOURCE_SCRAPE` job dispatched to a Chromium-free worker may discover it
needs a browser (BLVD: HTTP fetch detected a bot block and the worker has no
`browserService`). The adapter throws `EscalateCapabilitySignal`
(`packages/queue`, distinct from `RetryJobSignal` and ordinary errors); the
scraper engine closes the run row but never marks the source errored,
completes the run, or commits listings; the worker reports
`escalation: { capability: 'chromium', reason }` on the completion callback.

The coordinator's gateway processor then writes `requiresBrowser: true` and a
`capabilityEscalation` record into the **job's own persisted payload**
(`JobContext.updateData`) and requeues via `RetryJobSignal` (no attempt
consumed). Keeping the requirement in the job payload, rather than an
in-memory pin, means it survives a coordinator restart, is tied to the job's
stable id by construction, and is discarded when the job is removed or
trimmed by the queue's retention policy, so there is no separate pin state to
clean up (the dispatcher keeps nothing after a dispatch settles). The
redispatch reuses the same correlation id with a fresh `dispatchId`, so a
late report from the original worker is rejected as stale (as is any report
from a worker that disconnected, whose in-flight dispatches are failed
without penalty).

Bounds: a job escalates at most once (a second escalation request, or an
escalation from a job that already required Chromium, fails the job with an
explicit error); an escalated job with no Chromium-capable worker keeps
requeueing only up to `ESCALATION_WAIT_LIMIT_MS` (60 minutes), logging each
wait, then fails. After escalation, a block on the Chromium worker still ends
in the explicit `BlvdBlockedError`.

Caveats: the wait limit is measured from the first escalation, so any
requeue (including a source-concurrency-lock wait or a Chromium worker
disconnecting) past the limit fails the job; the 15s `RetryJobSignal` delay
rate-limits the whole `SOURCE_SCRAPE` consumer, so a long wait for a browser
worker briefly delays other sources' dispatch too. A failed job retried
manually from Bull Board keeps its payload and so counts as already
escalated (fail-closed: it cannot escalate again and its wait bound is
already spent) — re-enqueue a fresh job instead. Each handoff leaves one
`failed` `ScraperRun` row whose message starts with `Escalated to`.

## Capability matching

Each worker advertises capabilities in its `hello` message —
`chromium`, `httpEnrich`, `maxConcurrentJobs`
(`packages/types/src/worker-protocol.ts`). Configured via the
`WORKER_CAPABILITIES` env var (`apps/worker/src/config.ts`), comma-separated
`key=value` pairs; both `chromium` and `httpEnrich` default to `true` when
unset, so an un-configured worker claims every capability this binary
understands.

`pickWorker` filters to workers matching the job's required capabilities,
then picks whichever has the fewest jobs in flight.

## Chromium is gated per SOURCE (SOURCE_SCRAPE), per QUEUE (detail jobs)

Resolved in #1040/#1041. `ScraperSourceRegistryEntry.requiresBrowser`
(`packages/types/src/source-registry.ts`) says whether a source's
`SOURCE_SCRAPE` job needs Chromium. The flag travels in the job payload
(`requiresBrowser`, set when the job is enqueued) and `gateway-workers.ts`
uses it as the job's `chromium` requirement. A payload without the field
(a job queued before #1041) falls back to the old queue-level default,
`chromium: true`.

| Source | Mechanism | `requiresBrowser` |
| --- | --- | --- |
| BLVD | Fetch-first with an optional Playwright fallback (#1041) | false |
| Freedom Motors | Playwright (`freedom-motors.ts`) | **true** |
| Superior Van | Playwright (`superior-van.ts`) | **true** |
| MobilityWorks | Crawlee `CheerioCrawler` (`mobilityworks.ts`) | false |
| AMS Vans Classifieds | plain `fetch()` (`ams-vans-classifieds.ts`) | false |
| MobilityVanSales | Node `http`/`https` (`mobility-van-sales.ts`) | false |
| eBay Motors | plain `fetch()` against the Browse API (`ebay-motors.ts`) | false |

A worker with `WORKER_CAPABILITIES=chromium=false` is therefore eligible
for every `requiresBrowser: false` source and is excluded only from
Freedom Motors and Superior Van. `DETAIL_CRAWL` and `DETAIL_EXTRACT` stay
unconditionally chromium-gated: their handlers take a `BrowserService`
outright, so a worker with `chromium=false` is still excluded from
`DETAIL_CRAWL` and `DETAIL_EXTRACT` jobs. `httpEnrich` gating is queue-level
and unchanged.

## Per-source concurrency lock

`WorkerRegistry.sourceLocks` (`registry.ts`) allows **at most one in-flight
job per `sourceId`, across the entire fleet** — not per worker, system-wide.
The reason: scraping an HTML-rendered site from multiple machines at once
is how you get IP-rate-limited or banned.

That reasoning is specific to the HTML-scraped sources. It doesn't really
apply to eBay Motors: that source hits an authenticated JSON API, and the
actual constraint is a shared daily call quota tied to the API App ID
(5,000/day by default — see the comment on `MAX_ITEMS_PER_RUN` in
`ebay-motors.ts`), not IP reputation. Running it from 10 machines at once
wouldn't get anyone banned — but it also wouldn't unlock more quota, since
the quota is shared across all callers regardless of origin.

**Implication for distributing work to volunteer compute**: as built, the
per-source lock caps useful parallelism at "one worker per source"
(currently 8 sources), no matter how many workers are connected. Fanning a
*single* source's work out to many workers at once — e.g. splitting eBay
Motors into one job per keyword-search and one job per `getItem` batch,
instead of one atomic "scrape this whole source" job — would need the lock
(or a replacement) scoped to the sub-task rather than the whole source. Not
designed or built; discussed during #999's keyword-tuning work (2026-10)
when evaluating whether a volunteer-compute model made sense for this
fleet.

## What a worker is responsible for

- Dial the coordinator, authenticate with `WORKER_TOKEN` (must match the
  coordinator's `INTERNAL_API_SECRET`), send `hello` with its capabilities.
- Send a heartbeat every `HEARTBEAT_INTERVAL_MS` (15s,
  `apps/worker/src/ws-client.ts`) so the coordinator knows it's alive.
- Accept or refuse each dispatched job (`job-ack` over WS).
- Run the job — resolve the adapter, call its `scrape()`/equivalent — and
  POST the result back over the authenticated
  `/internal/workers/jobs/complete` and `/internal/scraper/*` routes.
- Nothing else. No direct database, search index, or cache access.

## Platform notes

- The worker process itself is plain Node.js — no OS-specific code. Should
  run unmodified on Linux/Windows/Mac for the four non-browser sources;
  this hasn't actually been verified working on Windows in this repo.
- The three Playwright-dependent sources (BLVD, Freedom Motors, Superior
  Van) ship Chromium builds for Windows/Mac/Linux, but add a large
  (~300MB) platform-specific binary download. Mobile (iOS/Android) isn't a
  realistic target for Playwright's Chromium at all.
- `chromium.launch({ chromiumSandbox: true })`
  (`packages/scraper-sources/src/browser/playwright-browser-service.ts`)
  has no `headless: false` override, so launching Chromium never opens a
  visible window on any platform — the cost of the three Playwright
  sources is the binary download and the sandboxed process, not a GUI
  popping up.
