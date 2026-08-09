# WivWav Scraper

Playwright-based scraper engine that collects WAV listings from multiple sources, stores raw HTML, and extracts structured data into the database.

---

## Environment setup

Copy the example env file before running anything:

```bash
cp apps/scraper/.env.example apps/scraper/.env
```

The defaults work for local dev. To enable AI-assisted CSS selector remapping, configure a provider via `/ops/ai` (Ollama for local, Anthropic for production — API key stored encrypted in the config DB). Scraping works without it — layout-changed sources are flagged for manual review.

---

## Running a scrape

Make sure `make up` is running so Postgres is available.

### Scheduled (automatic)

`make dev` starts the scraper service, which runs sources on their configured cron schedules:

| Source       | Schedule       |
| ------------ | -------------- |
| BLVD.com     | Every 6 hours  |
| MobilityWorks | Every 8 hours |

### One-off (manual trigger)

With the scraper service running, enqueue a source immediately via the admin API:

```bash
# List sources to get their IDs
curl http://localhost:3001/v1/admin/sources

# Trigger a scrape for a specific source
curl -X POST http://localhost:3001/v1/admin/sources/<id>/run
```

The job will appear in Bull Board and trigger the full downstream pipeline.

---

## Post-scrape pipeline

When a scrape is triggered via the queue, the downstream jobs run automatically on their own schedules (crawl hourly, extract every 5 minutes, geocode/deduplicate nightly). To trigger one manually:

```bash
# Detail crawl (requires sourceId)
curl -X POST http://localhost:3001/v1/admin/queues/detail-crawl/jobs \
  -H "Content-Type: application/json" \
  -d '{"data": {"sourceId": "<id>"}}'

# Detail extract (requires sourceId)
curl -X POST http://localhost:3001/v1/admin/queues/detail-extract/jobs \
  -H "Content-Type: application/json" \
  -d '{"data": {"sourceId": "<id>"}}'

# Geocode or deduplicate (no payload needed)
curl -X POST http://localhost:3001/v1/admin/queues/geocode/jobs -d '{}'
curl -X POST http://localhost:3001/v1/admin/queues/deduplicate/jobs -d '{}'
```

### 3. Sync to Meilisearch

Pushes all DB listings into the search index so they appear on the site. Requires the API to be running.

```bash
curl -X POST http://localhost:3001/v1/listings/sync
```

---

## Sources

| Source        | Adapter (packages/scraper-sources)   |
| ------------- | ------------------------------------ |
| BLVD.com      | `src/sources/blvd.ts`                |
| MobilityWorks | `src/sources/mobilityworks.ts`       |
| Freedom Motors | `src/sources/freedom-motors.ts`     |
| Superior Van  | `src/sources/superior-van.ts`        |

Adapters and the browser layer live in `packages/scraper-sources` (#950) so the
future DB-less worker (#948) can import them; this app consumes them via
`SOURCE_ADAPTER_MODULES`.

---

## Architecture

Each source has a `SourceAdapter` in `packages/scraper-sources/src/sources/` implementing:

- `checkStructure()` — fetches a sample page, hashes the DOM, compares to stored hash
- `scrape()` — runs the full Playwright scrape, returns normalized listings

If `checkStructure()` detects a change, the engine marks the source `needs_remapping` and calls the configured AI provider to derive new CSS selectors (default: Ollama; set `ai.scraper.structure.provider` in the config DB to switch). Sources run on independent cron schedules.

### Adding a new source

1. Create `packages/scraper-sources/src/sources/<name>.ts` implementing `SourceAdapter`
2. Add it to `SOURCE_ADAPTER_MODULES` in `packages/scraper-sources/src/sources/adapters.ts`
3. Add its registry entry to `SCRAPER_SOURCE_REGISTRY` in `packages/types/src/source-registry.ts` (apps/scraper upserts the `sources` row on startup)

### Pitfall inside `page.evaluate`

tsx's esbuild wraps named arrow-function-to-const assignments with `__name()`, which is not defined in the Playwright browser sandbox. Use `function` declarations instead of `const fn = () => {}` inside `page.evaluate`.
