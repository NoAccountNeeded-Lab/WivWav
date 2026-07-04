# API routes

Canonical list of HTTP routes exposed by `apps/api`. **Keep this table current** when you add, remove, or rename a route (see `AGENTS.md` → "How agents work").

| Method | Path                           | Description                          |
| ------ | ------------------------------ | ------------------------------------ |
| GET    | /health                        | Health check                         |
| GET    | /v1/listings                   | Search listings with filters         |
| GET    | /v1/listings/facets            | Facet aggregations (cached 60s)      |
| GET    | /v1/listings/:id               | Single listing detail                |
| GET    | /v1/listings/:id/price-history | Listing price history                |
| GET    | /v1/listings/:id/safety        | Safety summary (recalls with `status: open|remedied|unknown`, complaints, ratings, investigations, manufacturerCommunications, `safetyFreshnessDate`) for a listing |
| POST   | /v1/listings/:id/refresh-safety | Trigger on-demand NHTSA refresh (recalls, complaints, ratings, investigations, manufacturer communications) for the vehicle model linked to this listing. Rate-limited to once per model per hour. Returns `{ enqueued: bool, reason?, retryAfter?, jobIds? }`. |
| GET    | /v1/listings/:id/dealer        | Dealer profile + top 5 reviews for a listing. Returns `{ dealerProfile: null }` when no profile exists yet. |
| GET    | /v1/vin/:vin/safety            | Decode a VIN and return NHTSA safety summary when data is available |
| GET    | /v1/market/pricing                     | Price stats (percentiles, days listed, drop rate) for a make/model spec |
| GET    | /v1/market/popular                     | Top 10 makes, models, and conversion brands by active listing count |
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
| POST   | /admin/sync                    | Re-index all listings into Meilisearch |
| GET    | /admin/quarantine              | List quarantined listings, filterable by `sourceId`, `rule`, `severity` (`error`\|`warn`), `olderThanDays`; paginated via `skip`/`take` (max 200). Each row includes `rules: [{code, severity}]` and `extractionVersion` (latest `ListingObservation`, or `null`). Response: `{ data: [...], meta: { total, skip, take } }`. |
| POST   | /admin/quarantine/:id/reprocess | Reset a quarantined listing to `publicationStatus: 'pending'` so the next validator pass re-evaluates it (e.g. after an operator corrects upstream data). 404 if the listing is not currently quarantined. |
| GET    | /admin/listing-refresh/status  | Aggregate source, queue, observed/eligible listing, and map-readiness state for the guided refresh workflow |
| GET    | /admin/repeatables             | Canonical repeatable jobs merged with live BullMQ state |
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
| POST   | /admin/client-events           | Ingest a browser error event (js-error, unhandled-rejection, fetch-error, react-error) and log it via pino with `service: "web-client"` so it appears in the Loki pipeline. Returns 204. Unauthenticated. |
| GET    | /admin/board                   | Queue job inspector UI               |
| GET    | /metrics                       | Prometheus text-format scrape endpoint (prom-client). Exposes Node.js process metrics, HTTP request counts/latency by route, BullMQ queue depths per queue and status, DB size/listing count, Valkey and Meilisearch up gauges, Meilisearch listings-index document count/size and last sync timestamp, Loki up gauge, last successful source scrape timestamp, and NHTSA refresh recency by queue. Scraped by Prometheus every 15 s when the `obs` profile is active. |

Most responses use `{ data: T }` for success and `{ error: { code, message } }` for errors. Exceptions: `GET /v1/listings` returns `{ data, facets, pagination }`; `GET /v1/sources` returns `{ sources: [] }`.
