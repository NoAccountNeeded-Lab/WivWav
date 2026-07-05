# Ops Workflows

All operations below are done through the ops UI at **http://localhost:3002/ops** — never via CLI during normal operations. Direct the user to the relevant page; don't paste curl commands.

## Publication gate

An observed listing is not automatically public. Sources and Refresh Listings
show both observed active rows and listings explicitly eligible to publish.
Search, facets, detail routes, and market analytics use only eligible rows.

During the 2026-06-29 data-quality containment, listing queues and schedules
must remain paused and the search index must remain empty. Follow
[Listing Publication Containment and Recovery](listing-publication-containment.md)
before scraping, syncing, or resuming a listing pipeline.

## Get listings on the map

Listings need GPS coordinates to appear as pins on the search map. New scraped listings arrive without coordinates. The pipeline is:

1. **Scrape** — `/ops/sources` → "Run Now" on a source, or wait for its cron schedule.
2. **Geocode** — `/ops/queues` → find the `geocode` row → click **Trigger**. This resolves city + state → lat/lng for every ungeocoded listing. Rate-limited to 1 req/sec (Nominatim policy), but it deduplicates by unique city/state, so 4 000 listings in 200 distinct cities only fires 200 requests (~3–4 min), not 4 000.
3. **Sync Meilisearch** — same `/ops/queues` page → click **Sync Meilisearch** (top-right button). This clears the listing index and re-indexes only active, eligible listings from PostgreSQL so new coordinates become searchable and visible on the map.

Geocode incrementally syncs changed listings and runs nightly at 2 AM. A clean
full sync also runs nightly and is enqueued after source scrapes. Trigger a
manual full sync only when the containment runbook allows publication.

## Scrape a source immediately

`/ops/sources` → "Run Now" next to the source. Progress appears on `/ops/runs` and in the queue activity panel on `/ops/queues`.

## Inspect a job or retry a failure

`/ops/queues` → click a queue name to expand live job activity. For full payloads and stack traces, use the **Bull Board** link (top-right of the Queues page).

## Trigger any background job immediately

`/ops/queues` → find the queue → **Trigger** (where available). Queues that can be triggered: `geocode`, `detail-crawl`, `detail-extract`, `deduplicate`.

## Enable, disable, or edit a schedule

`/ops/schedules` — lists all repeatable jobs with their current cron pattern, next run time, and enable/disable status. Toggle or edit any schedule without restarting the scraper. Changes take effect immediately in BullMQ/Valkey.

Schedules are stored in **Valkey** by BullMQ, not in node-cron or any config file. The scraper registers defaults on first boot only — subsequent restarts do not override user changes. Disabling a schedule removes it from BullMQ; it stays disabled across scraper restarts.

BLVD.com and MobilityWorks have independent `detail-crawl` and
`detail-extract` rows. Disable or edit the row labeled for the affected source;
the other source keeps its own scheduler key and remains enabled. On the first
startup after upgrading from legacy BullMQ repeatables, the scraper replaces a
collided detail schedule with both source-specific schedulers. No direct Valkey
edit is required. To roll back an individual source, disable only its crawl and
extract rows before reverting the deployment.

## Background job schedule (defaults)

| Queue                | Default schedule  | Notes |
| -------------------- | ----------------- | ----- |
| source-scrape        | Per-source (6–8h) | Configured on each Source row |
| detail-crawl         | Per-source hourly | Playwright; rate-limited to 1 page/2 s |
| detail-extract       | Per-source every 5 min | No network; reads stored HTML |
| listing-sync         | Nightly 1:30 AM   | Clears and rebuilds search with active, eligible rows |
| geocode              | Nightly 2 AM      | Deduplicated by city/state |
| deduplicate          | Nightly 3 AM      | VIN-matched |
| vin-enrich           | Every 6h from 4 AM | NHTSA VIN decode → upsert VehicleModel |
| nhtsa-recalls        | Nightly 4:30 AM   | Recalls for all VehicleModels in inventory |
| nhtsa-complaints     | Weekly Sun 5 AM   | Complaints for all VehicleModels |
| nhtsa-safety-ratings | Weekly Sun 6 AM   | Safety ratings for all VehicleModels |
| vehicle-stats-refresh | Weekly Sun 1 AM  | Re-seeds lifespan/reliability stats from static JSON |

## Worktree port isolation

Unit tests use `app.inject()` and do not bind ports — concurrent workers running tests never conflict. The conflict is only if a worker starts a **dev server**.

Ports are assigned by **agent index**: `base + (AGENT_INDEX * 10)`

| Agent | Who          | API ports  | Web ports  |
| ----- | ------------ | ---------- | ---------- |
| 0     | Human/local  | 3000–3009  | 4000–4009  |
| 1     | First worker | 3010–3019  | 4010–4019  |
| 2     | Second       | 3020–3029  | 4020–4029  |
| 3     | Third        | 3030–3039  | 4030–4039  |

The existing default ports (API=3003, web=3000) fall naturally in the human range.

```bash
# Get the port for this agent's dev server
bash scripts/worktree-port.sh api 1   # → 3010  (agent 1 API)
bash scripts/worktree-port.sh web 2   # → 4020  (agent 2 web)
bash scripts/worktree-port.sh api     # → 3000  (human, no index)
```

Workers receive their `AGENT_INDEX` from the orchestrator via the spawn prompt.
If you need more than 10 ports per agent, change `STEP=10` to `STEP=100` in `scripts/worktree-port.sh` — ranges expand to 100-199, 200-299, etc.
