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

## ⚠️ Known gap: chromium is gated per QUEUE, not per SOURCE

`CHROMIUM_GATEWAY_QUEUES` (`gateway-workers.ts`) marks **every**
`SOURCE_SCRAPE`, `DETAIL_CRAWL`, and `DETAIL_EXTRACT` job as requiring
`chromium: true`, regardless of which source the job is actually for:

```ts
chromium: CHROMIUM_GATEWAY_QUEUES.includes(queueName),
```

But as of 2026-10, only 3 of the 8 registered source adapters actually
launch a browser:

| Source | Mechanism | Needs Chromium? |
| --- | --- | --- |
| BLVD | Playwright (`service.launch()` in `blvd.ts`) | **Yes** |
| Freedom Motors | Playwright (`freedom-motors.ts`) | **Yes** |
| Superior Van | Playwright (`superior-van.ts`) | **Yes** |
| MobilityWorks | Crawlee `CheerioCrawler` — migrated off Playwright; `browserService` config is `@deprecated` (`mobilityworks.ts`) | No |
| AMS Vans Classifieds | plain `fetch()` (`ams-vans-classifieds.ts`) | No |
| MobilityVanSales | Node's `http`/`https` modules directly (`mobility-van-sales.ts`) | No |
| eBay Motors | plain `fetch()` against the official Browse API (`ebay-motors.ts`) | No |

(Three different non-browser HTTP mechanisms already exist in this
codebase — Crawlee, native `fetch`, and raw Node `http`/`https` — which is
its own small inconsistency, separate from the chromium-gating issue.)

A worker that sets `WORKER_CAPABILITIES=chromium=false` (to skip the
~300MB Playwright Chromium download it doesn't want) is correctly excluded
from BLVD/Freedom Motors/Superior Van jobs today — but it's *also* excluded
from every other source-scrape job, including the four that never touch a
browser, because the requirement is set by queue name, not by the
dispatched source's actual needs.

**Fix shape** (not yet implemented): look up whether the dispatched
`sourceId`'s registry entry actually needs a browser — e.g. a
`requiresBrowser: boolean` field on `ScraperSourceRegistryEntry`
(`packages/types/src/source-registry.ts`), consulted in
`gateway-workers.ts`'s processor instead of the blanket
`CHROMIUM_GATEWAY_QUEUES.includes(queueName)` check. This is a prerequisite
for a genuinely Chromium-free worker build to ever receive real work.

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
