# API routes

Canonical list of HTTP routes exposed by `apps/api`. **Keep this table current** when you add, remove, or rename a route (see `AGENTS.md` → "How agents work").

A generated OpenAPI 3 document is served at `GET /openapi.json` (Swagger UI at `GET /docs`). Routes converted to TypeBox schema-first contracts (`apps/api/src/app.ts` registers the `@fastify/type-provider-typebox` type provider) are documented canonically by that generated spec — this table's description column may lag the schema for those routes. Currently converted: `GET /v1/listings`, `GET /v1/listings/facets`. All other routes remain documented here until converted in follow-up issues.

| Method | Path                           | Description                          |
| ------ | ------------------------------ | ------------------------------------ |
| GET    | /health                        | Health check                         |
| GET    | /openapi.json                  | Generated OpenAPI 3 document (TypeBox schema-first routes) |
| GET    | /docs                          | Swagger UI for the generated OpenAPI document |
| GET    | /v1/listings                   | Search listings with filters. Schema-first (TypeBox); see `/openapi.json`. Returns `503 { error: { code: SEARCH_UNAVAILABLE, message } }` when Meilisearch is unavailable — never falls back to an unfiltered database query (#669). |
| GET    | /v1/listings/facets            | Facet aggregations (cached 60s). Schema-first (TypeBox); see `/openapi.json`. |
| GET    | /v1/listings/:id               | Single listing detail                |
| POST   | /v1/listings/:id/reports       | Create an unresolved listing data report (`reportType`: `specs_incorrect`\|`sold_or_stale`\|`duplicate`\|`other`, optional `notes`). Returns `{ data: { id, listingId, reportType, notes, status, reportedAt } }`. |
| GET    | /v1/listings/:id/price-history | Listing price history                |
| GET    | /v1/listings/:id/safety        | Safety summary (recalls with `status: open|remedied|unknown`, complaints, ratings, investigations, manufacturerCommunications, `safetyFreshnessDate`) for a listing |
| POST   | /v1/listings/:id/refresh-safety | Trigger on-demand NHTSA refresh (recalls, complaints, ratings, investigations, manufacturer communications) for the vehicle model linked to this listing. Rate-limited to once per model per hour. Returns `{ enqueued: bool, reason?, retryAfter?, jobIds? }`. |
| GET    | /v1/listings/:id/dealer        | Dealer profile + top 5 reviews for a listing. Returns `{ dealerProfile: null }` when no profile exists yet. |
| GET    | /v1/vin/:vin/safety            | Decode a VIN and return NHTSA safety summary when data is available |
| GET    | /v1/vin/:vin/listings          | All active, publication-eligible listings across sources for a VIN. FREE. Powers the listing detail page cross-listings feature. |
| GET    | /v1/vin/:vin/history           | Merged price + mileage history (any listing status/source) for a VIN, ordered by `recordedAt` ascending. PRO+; 403 `upgrade_required` for FREE-tier callers. |
| GET    | /v1/dealers/:id                | Dealer profile: name, zip, rating, reviewCount, hours. FREE. 404 if the dealer does not exist. |
| GET    | /v1/dealers/:id/listings        | Paginated listings for a dealer (`?status=active\|gone\|all`, `?skip=`, `?take=`). `status=active` (default) is FREE; `status=gone`/`all` are PRO+ (403 `upgrade_required` for FREE-tier callers). |
| GET    | /v1/dealers/:id/reviews        | Paginated dealer reviews, newest first (`?skip=`, `?take=`). FREE. |
| GET    | /v1/market/pricing                     | Price stats (percentiles, days listed, drop rate) for a make/model spec |
| GET    | /v1/market/popular                     | Top 10 makes, models, and conversion brands by active listing count |
| GET    | /v1/market/trends              | Time-bucketed median price, active inventory count, and avg days-to-gone for a make/model (`?interval=week\|month`, `?from=`, `?to=`). PRO+; 403 `upgrade_required` for FREE-tier callers. |
| GET    | /v1/vehicles/:make/:model/stats            | Lifespan and reliability stats; returns `methodology` string and `sources: [{name, url}]` array (empty array when no source is recorded); optional `?year` falls back to aggregate row when no year-specific record exists |
| GET    | /v1/vehicles/:make/:model/:year/recalls        | Open recalls for a vehicle           |
| GET    | /v1/vehicles/:make/:model/:year/complaints     | Complaints for a vehicle             |
| GET    | /v1/vehicles/:make/:model/:year/research       | Latest cited model facts (EPA fuel economy, engine, drivetrain) with source URLs |
| GET    | /v1/vehicles/:make/:model/:year/investigations | NHTSA investigations for a vehicle model; each record has `sourceUrl` |
| GET    | /v1/vehicles/:make/:model/:year/communications | NHTSA TSBs (manufacturer communications) for a vehicle model; each record has `sourceUrl` |
| GET    | /v1/vehicles/:make/:model/:year/msrp           | Original MSRP from fueleconomy.gov; returns `originalMsrpCents`, `destinationFeeCents`, `currency`, and `source: {name, url, fetchedAt}` |
| GET    | /v1/conversion-brands          | List conversion brands with product counts and NMEDA certification status |
| GET    | /v1/conversion-brands/:slug    | Brand detail with full product catalog (conversionType, rampType, floorLoweringInches, msrpCents) |
| GET    | /v1/sources                    | List configured scraper sources      |
| GET    | /admin/queues                  | All queue names with stats           |
| GET    | /admin/queues/:name            | Single queue stats + recent jobs     |
| POST   | /admin/queues/:name/jobs       | Enqueue a job                        |
| POST   | /admin/queues/:name/pause      | Pause a queue                        |
| POST   | /admin/queues/:name/resume     | Resume a queue                       |
| GET    | /admin/runs                    | Recent scraper runs (last 100) + sourceName |
| GET    | /admin/sources                 | Sources with status plus observed-active and eligible-active listing counts |
| POST   | /admin/sources/:id/run         | Enqueue an immediate source-scrape job |
| GET    | /admin/sources/:id/pipeline    | Per-stage pipeline state for one source: source-scrape (last run + failed jobs) plus DB-derived detail-crawl, detail-extract, geocode, and vin-enrich stages, each with `pendingCount`, `lastCompletedAt`, `failedCount` (source-scoped for detail-crawl/detail-extract/source-scrape; queue-wide for geocode/vin-enrich, whose job payloads carry no `sourceId`), `stalled` (pending work with no completion inside a 6h threshold), and `latestFailedJobId` (id of the most recent failed job, only populated when the failure is known to belong to this source; powers the "Explain this error" action). 404 if the source does not exist. |
| POST   | /admin/sync                    | Enqueue a full versioned re-index of listings into Meilisearch (builds into a new index and atomically swaps it in; the scraper's `listing-sync` worker owns the rebuild). Returns `202 { data: { enqueued: true, jobId } }`. Deduped by a fixed jobId — a burst of triggers collapses into one pending rebuild. |
| GET    | /admin/quarantine              | List quarantined listings, filterable by `sourceId`, `rule`, `severity` (`error`\|`warn`), `olderThanDays`; paginated via `skip`/`take` (max 200). Each row includes `rules: [{code, severity}]` and `extractionVersion` (latest `ListingObservation`, or `null`). Response: `{ data: [...], meta: { total, skip, take } }`. |
| POST   | /admin/quarantine/:id/reprocess | Reset a quarantined listing to `publicationStatus: 'pending'` so the next validator pass re-evaluates it (e.g. after an operator corrects upstream data). 404 if the listing is not currently quarantined. |
| GET    | /admin/field-conflicts         | #499 operator triage: active listings whose `conversionType`/`rampType` resolution is `conflicting`, one row per (listing, field), with the competing claims that caused it (`competingValues`, `evidenceKinds`, `sourceRefs`, `observedAts` — no free-text evidence). Filterable by `sourceId`, `field`; paginated via `skip`/`take` (max 200). Response: `{ data: [...], meta: { total, skip, take } }`. |
| GET    | /admin/listing-reports         | Operator triage for listings with unresolved user reports, sorted by unresolved report count then latest report. Filterable by `minReports`; paginated via `skip`/`take` (max 200). Response: `{ data: [{ listingId, sourceUrl, make, model, year, unresolvedCount, latestReportedAt, reportTypes }], meta: { total, skip, take } }`. |
| GET    | /admin/listing-refresh/status  | Aggregate source, queue, observed/eligible listing, and map-readiness state for the guided refresh workflow |
| GET    | /admin/repeatables             | Canonical repeatable jobs merged with live BullMQ state; source-specific detail schedules have distinct IDs, payloads, next runs, and last statuses |
| DELETE | /admin/repeatables/:queue      | Disable a repeatable job (remove from BullMQ by key) |
| POST   | /admin/repeatables/:queue      | Enable a repeatable job (add to BullMQ) |
| PUT    | /admin/repeatables/:queue      | Update a repeatable job's pattern (remove old key, add with new pattern) |
| GET    | /admin/ai/status               | Scraper AI provider health (Ollama by default) + installed models + sources needing remap |
| POST   | /admin/ai/explain-error        | Plain-language, AI-generated explanation of a failed job's error/stack trace for the pipeline view's "Explain this error" action. Body: `{ data: { queue, jobId } }`; `queue` must be a known registered queue name (rejected with 404 otherwise, before any queue is instantiated). Prompt explicitly forbids proposing code changes — explanation/triage only, not a verified fix. 404 if the queue is unknown or the job is not found among that queue's failed jobs; 400 if the job has no recorded failure reason; 502/503 if Ollama errors or is unreachable/times out (30s bound). |
| GET    | /admin/config                  | List all current config values (latest row per key). Secrets return hint only. |
| GET    | /admin/config/:key             | Get current value for one key (404 if tombstoned) |
| PUT    | /admin/config/:key             | Insert a new config row (append-only). Secrets: encrypts + returns hint. |
| GET    | /admin/config/:key/history     | All historical rows for a key (newest first) |
| GET    | /admin/config/:key/decrypt     | Decrypted plaintext for a secret key (server-to-server only — requires `Authorization: Bearer {INTERNAL_API_SECRET}` in production) |
| DELETE | /admin/config/:key             | Soft-delete: inserts a tombstone row (value: null) |
| GET    | /admin/logs                    | Recent log entries from Loki (query params: `service`, `search`, `limit` [default 200, max 500], `start` [ISO or ns epoch, default: 1 hour ago], `end` [ISO or ns epoch, default: now]); response: `{ data: { entries: LogEntry[], services: string[] } }`. Requires `LOKI_URL` env var (default `http://localhost:3100`; Docker Compose sets `http://loki:3100`). |
| GET    | /admin/logs/services           | Distinct service label values from Loki; response: `{ data: string[] }` |
| GET    | /admin/board                   | Queue job inspector UI (Bull Board). Reachable only through the ops BFF's authenticated session; fails closed like every other `/admin` route. |
| POST   | /telemetry/client-events       | Ingest a browser error event (js-error, unhandled-rejection, fetch-error, react-error) and log it via pino with `service: "web-client"` so it appears in the Loki pipeline. Returns 204. Unauthenticated (public exception — see below); moved out of `/admin` in #450 so it isn't caught by the admin fail-closed boundary. Same narrow schema and per-route rate limit as before. |
| GET    | /metrics                       | Prometheus text-format scrape endpoint (prom-client). Exposes Node.js process metrics, HTTP request counts/latency by route, BullMQ queue depths per queue and status, DB size/listing count, Valkey and Meilisearch up gauges, Meilisearch listings-index document count/size and last sync timestamp, Loki up gauge, last successful source scrape timestamp, and NHTSA refresh recency by queue. Scraped by Prometheus every 15 s when the `obs` profile is active. |

Most responses use `{ data: T }` for success and `{ error: { code, message } }` for errors. Exceptions: `GET /v1/listings` returns `{ data, facets, pagination }`; `GET /v1/sources` returns `{ sources: [] }`.

## Admin auth boundary (fail-closed)

Every route under `/admin` — including `/admin/board` — is guarded by a single `onRequest` hook (`apps/api/src/plugins/admin-auth.ts`) applied via Fastify plugin encapsulation:

- **Production, no `INTERNAL_API_SECRET` configured:** every `/admin/*` request is refused with `503 ADMIN_DISABLED`. The API never silently serves admin surfaces unauthenticated in production.
- **`INTERNAL_API_SECRET` configured (any environment):** requests must carry `Authorization: Bearer <secret>`, or receive `401 UNAUTHORIZED`.
- **Non-production, no secret configured:** requests pass through unauthenticated. This permissive mode only exists for local dev/CI and is unreachable when `NODE_ENV=production`.

`apps/ops` never calls `/admin/*` from the browser. It authenticates operators with its own session (login page + signed cookie) and proxies admin calls server-side through its BFF routes (`apps/ops/src/app/api/bff/*` and `apps/ops/src/app/admin/board/*`), injecting `INTERNAL_API_SECRET` there. See `apps/ops/src/lib/session.ts` and `apps/ops/src/middleware.ts`.

### Public exceptions to the admin boundary

These routes are deliberately reachable without the admin credential:

- `/health` — liveness/readiness probe; no sensitive data returned.
- `/metrics` — Prometheus scrape endpoint; policy is network-level isolation (only scraped by Prometheus on the internal `obs` compose network), not application auth. Do not expose this port publicly.
- `/telemetry/client-events` — narrow, schema-validated browser telemetry sink, rate-limited per-route (10/min), re-pathed out of `/admin` in #450 specifically so it is never caught by the fail-closed admin boundary above.
