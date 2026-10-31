# WivWav pipeline audit (2026-10-16)

Scope: read-only. Code read from the main checkout; SQL run read-only against the local Postgres snapshot (7,518 listings). "VERIFIED" = read in code or counted in SQL. "INFERRED" = reasoned, not proven.

Headline: the gate exists but it is a data-validity gate, not a completeness gate. A listing becomes `eligible` at the first scrape of its card, before detail crawl, VIN decode, geocode or dedupe. Only 120 of 7,060 public listings (1.7%) have every stage marker the schema can show.

## 1. PIPELINE MAP

### 1.1 Queues and jobs (VERIFIED: packages/queue/src/queues.ts, apps/api/src/schedule-defs.ts, apps/api/src/index.ts, apps/worker/src/handlers/*)

23 queues. Consumers split across two processes. `apps/api/src/index.ts` runs BullMQ workers for geocode, deduplicate, vehicle-stats-refresh, conversion-brands-seed, nmeda-dealers-seed, listing-sync, listing-index-poll, listing-resolve, rawpage-cleanup, private-seller-retention and image-semantic-analyze. The remote `apps/worker` runs the rest through the API's worker-gateway (`gateway-workers.ts`): source-scrape, detail-crawl, detail-extract, the 5 NHTSA queues, vin-enrich, model-research, fueleconomy-msrp and dealer-enrich. Cron times use the first source's timezone. Source-scrape, detail-crawl and detail-extract are per source.

| Queue | Trigger | Reads | Writes | Needs first | Cadence |
|---|---|---|---|---|---|
| source-scrape | cron per source (`sources.cronExpression`: 6h BLVD, 8h MobilityWorks, 12h others) or admin "run" | live site list pages | `listings` upsert (card fields, `cardImages`, `images` seeded, `publicationStatus` from card validator, `qualityIssueCodes`, `qualityCheckedAt`, `lastRunId`), `listing_observation(stage=list_card)`, `scraper_runs`, `listing_price_history`, `listing_mileage_history`, source drift baseline and status | none | 6 to 12 h |
| detail-crawl | cron `0 * * * *` per source (CRITICAL options) or admin | listings with `detailScrapedAt` null or older than 30 days, batch 50, 2 s per page | `raw_pages` (HTML); marks gone on 404 | scrape | hourly |
| detail-extract | cron `*/5 * * * *` per source | `raw_pages` with `processedAt` null, batch 100 | `listings` detail fields (`images`, `description`, conversion fields, `detailScrapedAt`), then `publicationStatus='pending'`, `qualityCheckedAt=null`; `listing_observation(stage=detail)`, `listing_field_claim`, `listing_image`; enqueues listing-resolve only if an accessibility field changed | detail-crawl | every 5 min |
| listing-resolve | enqueued by scrape, detail-extract, vin-enrich, canonicalize backfill, search-reconciliation. No cron. | pending rows | `publicationStatus`, `qualityIssueCodes`, `qualityCheckedAt` via `validateListing` and `decidePublication` | detail-extract or vin-enrich | event-driven |
| geocode | cron `0 2 * * *` | listings with `lat` null and city and state present | `lat`, `lng` (Nominatim, 1.1 s per call) | scrape | daily |
| deduplicate | cron `0 3 * * *` | listings sharing a VIN | `Vehicle` row, `listing.vehicleId`, `isDuplicate`, `canonicalId` | scrape (detail improves its tie-break score) | daily |
| vin-enrich | cron `0 4/6 * * *` | claims listings with `vin` set and `vehicleModelId` null | `vehicle_models` find-or-create, `vehicleModelId`, `vehicleModelMatchConfidence='exact'`, `publicationStatus='pending'`; or `quarantined` on NHTSA mismatch; enqueues listing-resolve | scrape | every 6 h |
| nhtsa-recalls | cron `30 4 * * *` | `vehicle_models` | `recalls` | vin-enrich creates models | daily |
| nhtsa-complaints, nhtsa-safety-ratings, nhtsa-investigations, nhtsa-manufacturer-communications | cron Sundays 05:00, 06:00, 06:30, 07:00 | `vehicle_models` | `complaints`, `safety_ratings`, `investigation`, `manufacturer_communication` | vin-enrich | weekly |
| model-research | cron `30 5 * * 0` | models without current research | `vehicle_model_research`, `vehicle_model_source`, `vehicle_model_claim` (EPA) | vin-enrich | weekly |
| fueleconomy-msrp | cron `30 7 * * 0` | models | `vehicle_model_pricing` | vin-enrich | weekly |
| dealer-enrich | cron `0 7 * * *` | dealer listings with name and zip | `dealer_profiles`, `dealer_reviews` (Google Places) | scrape | daily |
| vehicle-stats-refresh | cron `0 1 * * 0` | eligible listings | `vehicle_stats` | none | weekly |
| listing-sync | cron `30 1 * * *` | all `active` and `eligible` listings | full Meilisearch rebuild | none | daily |
| listing-index-poll | cron `* * * * *` | listings changed since `search_indexer_checkpoint` | incremental Meilisearch update (job run every minute) | none | every minute |
| rawpage-cleanup | cron `0 0 * * *` | `raw_pages` | deletes old pages | none | daily |
| private-seller-retention | cron `15 0 * * *` | gone private-seller rows | anonymizes rows, removes from search | none | daily |
| conversion-brands-seed, nmeda-dealers-seed | cron Sundays 01:15 and 01:20 | static data | `conversion_brands`, `nmea_dealers` | none | weekly |
| image-semantic-analyze | NO schedule. Only the CLI `semantic-image-analyze-backfill.ts` (and the `-local` CLI) enqueue it. Consumer is registered in the API. | `listing_image` | `listing_image_semantic_analysis` | detail-extract (creates `listing_image`) | never automatic |

Not scheduled and not queues (VERIFIED, CLI or one-off only): `publication-backfill`, `canonicalize-backfill`, `title-tokenizer-backfill`, `image-integrity-backfill`, `vehicle-identity-backfill`, `match-vehicle-identity`, `field-claims-backfill`, `listing-quality-audit`, `search-reconciliation`. `match-vehicle-identity` is the only code that links non-VIN listings to a `Vehicle`; nothing runs it.

Comment drift (VERIFIED): the header of `queues.ts` says "dealer-enrich not yet wired", but it is scheduled and has a handler. The pipeline order comment omits vin-enrich and listing-resolve.

### 1.2 Ran, never ran (VERIFIED: `job_run` in the local DB)

| Job | `job_run` rows |
|---|---|
| source-scrape | 3 succeeded, 1 failed, 5 stuck `running` since 2026-10-11 |
| listing-index-poll | 259 succeeded |
| listing-sync | 2 |
| geocode, deduplicate, rawpage-cleanup, private-seller-retention | 1 each, today |
| listing-resolve | 3 (2026-10-11) |
| detail-crawl, detail-extract, vin-enrich, model-research, fueleconomy-msrp, dealer-enrich, vehicle-stats-refresh, conversion-brands-seed, nmeda-dealers-seed, all 5 NHTSA queues | 0 rows |
| image-semantic-analyze | 0 rows, no schedule |

Caveats (INFERRED): `listing_observation` holds 977 `detail` rows for 768 listings, so detail work did run with no `job_run` row, probably from the worker path or a manual run. The local snapshot may simply predate those crons. Local data supports "never ran locally", not "broken in production". The 5 stuck `running` source-scrape rows are a real hygiene issue: a crashed run is never closed.

### 1.3 Real dependency order

```
 source-scrape (6-12h per source)
   |  upsert card -> listing; validateListing(card) -> publicationStatus = eligible|quarantined   <== PUBLISHED HERE (first scrape)
   |  card change enqueues listing-resolve{sourceId}
   v
 detail-crawl (hourly, 50 listings/run) --raw_pages--> detail-extract (5 min, 100 pages/run)
   |  sets detailScrapedAt, images, conversion fields; publicationStatus = pending  (UNPUBLISHES)
   |  enqueues listing-resolve{listingId} ONLY IF an accessibility field changed
   v
 listing-resolve --> validateListing(full row) --> eligible | quarantined                      <== re-published here
   ^
   |  (sets pending again on a new VIN decode)
 vin-enrich (6h) --vehicleModelId--> [nhtsa-recalls, nhtsa-complaints, safety-ratings, investigations, mfr-communications, model-research, fueleconomy-msrp] (these only feed the vehicle page)

 geocode (02:00 daily)  --lat/lng-->        (does not touch publicationStatus)
 deduplicate (03:00 daily) --vehicleId/isDuplicate/canonicalId--> (does not touch publicationStatus)
 dealer-enrich (07:00) --dealer_profiles--> (listing.dealerProfileId is never set; see 3)
 image-semantic-analyze: manual only

 listing-index-poll (every minute) / listing-sync (01:30 daily):  WHERE status='active' AND publicationStatus='eligible' AND source not disabled
   v
 Meilisearch --> GET /v1/listings, /facets          Postgres --> GET /v1/listings/:id, /vin/:vin, /market
```

The schedules are staggered by clock time, not by dependency. Geocode (02:00) and dedupe (03:00) run on whatever exists at that moment. There is no "after X finishes" link between them and detail-extract, and none of the three affects `publicationStatus`.

## 2. PER-LISTING STAGE CHECKLIST

| # | Stage / fact | Proof marker | Marker quality |
|---|---|---|---|
| 1 | Card scraped | `scrapedAt`, `lastRunId`, `listing_observation(stage=list_card)` | good |
| 2 | Card validated | `qualityCheckedAt`, `qualityIssueCodes` | exists, but a card-only pass counts |
| 3 | Detail crawled + extracted | `detailScrapedAt`, `listing_observation(stage=detail)` | good, one column |
| 4 | Detail validated after extraction | `publicationStatus != pending` and `qualityCheckedAt` newer than `detailScrapedAt` | derivable; no explicit flag |
| 5 | VIN decoded and model matched | `vehicleModelId`, `vehicleModelMatchConfidence` | only for listings with a VIN; no marker for "tried and failed" or "no VIN" |
| 6 | Geocoded | `lat` not null | cannot tell "not yet" from "ungeocodable"; 1,430 listings have no city or state |
| 7 | Deduplicated | none. `vehicleId` is set only for VIN groups of 2 or more (all 424 `vehicle` rows have 2+ listings). | untrackable today |
| 8 | Images present | `images` length at least 1; `listing_image` rows; `cardImages` | `images` is seeded from the card; detail replaces it. `listing_image` has rows for 1 listing only |
| 9 | Conversion type and ramp resolved | `conversionType`, `rampType`, `conversionTypeResolution`, `rampTypeResolution` | `unknown` is a legitimate end state; cannot tell "undecided" from "genuinely unknown" |
| 10 | Dealer enriched | `dealerProfileId` | never populated (0 of 7,060); `dealer_profiles` is empty. Dead FK. |
| 11 | Image semantic analysis | `listing_image_semantic_analysis` | manual only |
| 12 | Indexed in search | Meilisearch doc | no marker in Postgres; checkpoint is by `updatedAt` only |

Absent: any per-listing record of which job last touched which stage, and any record of failed attempts. `listing_observation` covers only 2 stages (list_card, detail). `job_run.lastRunId` is overwritten by every writer.

## 3. GATE AUDIT

### 3.1 Where `eligible` is decided (VERIFIED)

- `apps/worker/src/engine/scraper-engine.ts:236-241` runs `validateListing(card)` then `decidePublication` and writes the result with the upsert (`packages/db/src/ingest/listing-ingest.ts:217,367`). The upsert overwrites `publicationStatus` on every re-scrape of a card, even for a listing that already passed detail.
- `apps/api/src/jobs/listing-resolve.ts:resolveRow` applies the same validator to the full row.
- `apps/api/src/engine/listing-validator.ts:311-317`: `quarantined` if any issue has severity `error`, or a warn in `WARN_RULES_THAT_BLOCK_PUBLICATION` (only `unsupported_accessibility_claim`). Otherwise `eligible`.
- The validator checks field validity (format, plausibility, cross-field, authoritative VIN mismatch). It never checks whether a stage ran.
- `pending` is set by `detail-apply.ts:255` (every detail write), by vin-enrich after a decode, and by the quarantine reprocess. It is only set; nothing requires completion before the next publish.
- `apps/worker/src/engine/listing-validator.ts` and `apps/api/src/engine/listing-validator.ts` are two copies that already differ (diff reports different). That is a drift risk.

### 3.2 What readers require (VERIFIED)

All require only `status='active' AND publicationStatus='eligible'` (and source not disabled):
- `search-indexer-poll.ts` and `meilisearch-sync.ts:52,203`.
- `listing-search.ts:67` (the Meilisearch filter for `/v1/listings` and `/facets`).
- `listing-repository.ts` `findById` (`/v1/listings/:id`), `findCrossListingsByVehicleId`, `findHistoryByVin` (`/vin`), and the market-repository queries.

No reader checks `detailScrapedAt`, `lat`, `vehicleModelId`, images or conversion type. So yes: the web and API show listings that have not passed every stage.

### 3.3 Quantification (SQL on local DB, read-only)

Totals: `select status,"publicationStatus",count(*) from listings group by 1,2` gives:

| status | publicationStatus | count |
|---|---|---|
| active | eligible | 7,060 |
| active | pending | 386 |
| active | quarantined | 39 |
| gone | eligible | 3 |
| possibly_gone | eligible | 30 |

Note: `possibly_gone` and `gone` rows are `eligible` but not shown (filter is `active`).

Of the 7,060 active and eligible listings (single query over `status='active' and "publicationStatus"='eligible'`):

| Missing marker | Count | % |
|---|---|---|
| `detailScrapedAt` null (never detail-crawled) | 6,920 | 98.0 |
| `lat` null | 1,923 | 27.2 |
|  of which no city or state (cannot geocode) | 1,430 |  |
|  of which geocodable but waiting | 493 |  |
| `vin` null | 382 | 5.4 |
| VIN present, `vehicleModelId` null (not decoded) | 6,518 | 92.3 |
| `vehicleModelId` null (any reason) | 6,900 | 97.7 |
| `vehicleId` null | 6,424 | 91.0 (not meaningful as a gap, see section 2 row 7) |
| `images` empty | 24 | 0.3 |
| `images` exactly 1 | 5,718 | 81.0 |
| `conversionType='unknown'` | 4,571 | 64.7 |
| `rampType='unknown'` | 6,793 | 96.2 |
| `qualityCheckedAt` null | 0 | 0 |
| `dealerProfileId` null | 7,060 | 100 |

Zero missing markers:
- Strict (detail + lat + `vehicleModelId` + images > 1 + conversion known): 43 (0.6%).
- Realistic (detail done; lat present or no city/state; VIN decoded or no VIN; at least 1 image; conversion known): **120 (1.7%)**.
- Detail done alone: 140 of 7,060. The detail stage is the dominant gap (98%).

Pending: 386 active rows; 385 have `detailScrapedAt` set and `qualityCheckedAt` null. These are waiting on listing-resolve. Hypothesis (INFERRED from code, not proven): detail-extract writes `pending` for every detail write but only enqueues listing-resolve when `changedFields` includes an accessibility field (`detail-apply.ts:133-159`), so detail-extracted listings with no accessibility change can sit `pending` (invisible) until a source-scrape resolve drain happens. Only 3 listing-resolve runs exist locally. Needs a check in production-like conditions.

Also: 135 eligible rows have `qualityCheckedAt` older than the first listing-resolve run, so "eligible" is mostly the scrape-time decision.

Detail throughput (VERIFIED code): 50 listings per hourly job per source. BLVD has 5,391 undetailed, so about 108 hourly runs, roughly 4.5 days of clean running, assuming no failures and no 30-day staleness re-queue.

### 3.4 Provenance (VERIFIED)

- `listing_observation`: 10,084 `list_card` rows (7,517 listings) and 977 `detail` rows (768 listings). Has `stage`, `reference`, `changedFields`, `before`/`after`, `observedAt`. Only 2 stages. Good as an event log for scrape and detail, nothing for geocode, dedupe, VIN.
- `job_run`: 1 row per execution with `parentRunId` tree and `sourceId`; no `listingId`. The tree is source-level only (`/admin/sources/:id/job-runs`).
- `listings.lastRunId` is set on 7,517 rows but is overwritten by whichever write was last, so it is not history.
- `listing_field_claim`: 3,563 rows for 2,934 listings (field-level evidence, not stage evidence).

## 4. OPS VISIBILITY AUDIT

What exists (VERIFIED from `apps/ops/src/app/ops/*` and `apps/api/src/routes/admin.ts`):
- queues: BullMQ counts per queue (waiting, active, completed, failed, delayed), pause/resume, "run now" per queue, per-job cancel/retry/make-ready (#1153, #1155), link to Bull Board at `/admin/board`.
- runs: flat list from `/admin/runs` (scraper runs) and the per-source pipeline tile view.
- schedules: repeatable job list and timeline from `/admin/repeatables`.
- sources: per-source page with 5 stage tiles from `/admin/sources/:id/pipeline` (source-scrape, detail-crawl, detail-extract, geocode, vin-enrich): pending count, last completed, failed, stalled. This is the closest thing to a pipeline view. It covers 5 stages only.
- problems and readiness: derived from the same admin endpoints (queues, sources, runs, repeatables, search total). Readiness checks infrastructure health, not data completeness.
- `/admin/quarantine` and `/admin/field-conflicts` list quarantined and conflicting listings.

Why it is confusing:
1. Everything is organized by queue or source, not by the listing's journey. The owner's question is per listing and per stage.
2. Queue "waiting" counts are BullMQ job counts, not "listings needing this stage". Detail-crawl shows 1 job while 6,920 listings need it.
3. The detail-crawl "pending" count in the per-source view includes listings stale beyond 30 days, but the public site shows them anyway.
4. Order is invisible: nothing shows that vin-enrich must precede the NHTSA queues, or that geocode and dedupe are independent of publish.
5. Jobs with no `job_run` rows look the same as healthy-idle jobs. Schedules page does not mark "never ran".
6. 5 source-scrape runs stuck `running` since 10-11 are not flagged.
7. Bull Board shows raw payloads; it cannot show which listings a job touched.

Questions that cannot be answered today: "what has run for listing X" (no per-listing log beyond `listing_observation`), "what is waiting overall and for which listings", "why is listing X not published / why is it published", "in what order should I run things", "which listings would be hidden under a strict gate".

## 5. PROPOSAL

Constraint from #1103 (as briefed): no new pipeline stage; readiness is a computed predicate inside existing jobs or the indexer.

### (a) Readiness predicate

A single pure function `computeReadiness(listing) -> { ready: boolean, blockers: string[], warnings: string[] }` in one shared module (also dedupes the two `listing-validator.ts` copies). Evaluated in `listing-resolve.resolveRow`, at scrape-time `decidePublication`, and in the indexer WHERE clause as the final guard. Persist the result in the existing `publicationStatus` (extend semantics: `eligible` means validator-clean AND ready). Optionally a nullable `readinessBlockers String[]` column (additive) so ops can read "why not".

Hard blocks (listing stays `pending`, not shown):
1. `detailScrapedAt` not null (detail crawled and extracted). Largest effect.
2. Validator result not `quarantined` and `qualityCheckedAt` >= `detailScrapedAt` (re-validated after the latest detail).
3. `images` has at least 1 entry. (Requiring more than 1 is a warning, since 81% have 1 from the card.)
4. VIN present implies `vehicleModelId` not null (decoded). VIN-less listings are exempt.
5. Conversion type known OR the detail pass completed (so `unknown` after detail is an accepted final state). Distinguish by `conversionTypeResolution`.

Warnings (shown, flagged in ops, not blocking):
- `lat` null (geocode pending or ungeocodable); `ramp unknown`; single image; no dealer profile; `images` from card only.

Do not gate on: `vehicleId` (only meaningful for duplicate VINs), `dealerProfileId` (dead column), image semantic analysis (manual), NHTSA/model-research (vehicle page extras).

Mechanics (no new stage): extend the existing triggers. detail-extract always enqueues listing-resolve (fix the accessibility-only condition), geocode and vin-enrich re-enqueue listing-resolve for the rows they just changed, and listing-resolve is the only writer of `eligible`. The scrape upsert must stop overwriting `publicationStatus` with `eligible` on a card re-scrape of a detail-complete listing; it should re-run the full predicate.

### (b) Per-listing pipeline timeline

Using existing data, no new table (v1): derive rows `{stage, status, at}` in an admin endpoint `GET /admin/listings/:id/pipeline`:
- card scraped: `scrapedAt` and `listing_observation(list_card)`.
- detail: `detailScrapedAt` and `listing_observation(detail)`.
- validated: `qualityCheckedAt` and `qualityIssueCodes`.
- VIN decode: `vehicleModelId` (done / skipped no VIN / waiting).
- geocode: `lat` (done / not geocodable if no city or state / waiting).
- dedupe: `isDuplicate`, `canonicalId`, `vehicleId` (done by cron cadence only; mark "n/a").
- indexed: query Meilisearch for the doc.
- Plus the blocker list from (a).

Gaps that this cannot fill: failed attempts, geocode and VIN-decode timestamps, per-run attribution. If wanted, add one additive table `listing_stage_event(listingId, stage, status, at, jobRunId)` written by the existing jobs on completion or failure. `job_run` cannot supply this (no listing id); `listing_observation` can only supply card and detail.

### (c) Ops "Pipeline" page spec

Route `apps/ops/src/app/ops/pipeline`. One row per stage in dependency order, columns: scrape, detail-crawl, detail-extract, listing-resolve, vin-enrich, geocode, dedupe, indexed. Each cell: done / waiting / blocked / failed counts, computed by one SQL aggregation (the per-stage count predicates from section 3.3), plus the queue depth and last `job_run` for that stage. Drill-down: click a cell to open a listings list filtered by that blocker (reuse the quarantine list view, #1108 problem listings browser). Row actions reuse existing controls: run now, pause/resume, and the per-job cancel/retry/make-ready from #1153/#1155. A banner shows "N active listings would be hidden under the strict gate". A footer lists schedule order and "never ran" flags from `job_run`.

### (d) Risks and migration

What a strict gate hides today (SQL above): of 7,060 public listings, 6,920 would drop out for lacking detail, leaving about 140; with the other hard blocks about 120. So search would shrink from 7,060 to roughly 120 listings until detail crawl catches up, roughly 4.5 days of continuous hourly crawling for BLVD alone (INFERRED from batch size). Also: 385 pending listings are already hidden and stuck, which a strict gate would not worsen but would not fix.

Order to avoid an outage: ship visibility and counting first, then backfill detail, then flip the gate. Add a config flag `PUBLISH_GATE_STRICT` so the predicate runs in report-only mode first (record blockers, do not change `publicationStatus`). Raise detail-crawl batch size or concurrency for the backfill window (INFERRED; check source politeness first). Backfill: run listing-resolve over all active rows once the predicate is live. Dead-code cleanup: drop `dealerProfileId` or populate it; remove or schedule the match-vehicle-identity CLI.

Risks: (1) the scrape upsert overwrite bug (card re-scrape resets `eligible`) must be fixed or the gate leaks. (2) the two validator copies must be merged. (3) `vin-enrich` flips rows to `pending` and relies on a resolve enqueue that failed silently in the pending set above. (4) Sources whose detail pages block crawling would be permanently hidden; need a per-source "card-only is acceptable" setting or an explicit warn path.

### (e) Issues, recommended order

1. **Fix the publish leaks (P0, small).** Make detail-extract and vin-enrich always enqueue listing-resolve; stop the scrape upsert from overwriting `publicationStatus` after detail; merge the two `listing-validator.ts` copies into one module. Accept: no active row stays `pending` with `detailScrapedAt` set after one resolve drain (SQL 385 -> 0); one validator import; tests cover the re-scrape case.
2. **Shared readiness predicate, report-only (P0).** `computeReadiness` plus tests; wired into listing-resolve and the scraper decision; writes blockers into a new nullable `readinessBlockers text[]` column; config flag defaults to report-only. Accept: SQL reproduces 120 / 7,060 ready; unit tests per blocker and per exemption (no VIN, no city).
3. **Ops Pipeline overview page + counts endpoint (P1).** `GET /admin/pipeline/overview` (one aggregation query) and the page from (c) with drill-down links and existing controls. Accept: counts match the SQL in section 3.3 exactly; every stage shows last `job_run` and "never ran"; click-through lists the listings.
4. **Per-listing pipeline timeline (P1).** `GET /admin/listings/:id/pipeline` plus a panel on the ops listing page using existing columns and `listing_observation`; shows blockers. Accept: timeline for a detail-complete and a card-only listing matches DB; Meilisearch indexed status shown.
5. **Flip the gate and backfill (P2, after 1-3).** Turn `PUBLISH_GATE_STRICT` on in indexer and read paths (`findById`, `/vin`, market) once the Pipeline page shows detail backlog under an agreed threshold; run the one-off resolve backfill; close stuck `running` `job_run` rows (add a reaper). Accept: public count equals "ready" count on the Pipeline page; rollback is flipping the flag.

Optional later: `listing_stage_event` table if failed-attempt history is wanted; schedule or remove image-semantic-analyze.

## Verified vs inferred summary

Verified: queue list, schedules and cron patterns, consumer location (API vs worker), every `publicationStatus` write path listed, indexer and API read predicates, all SQL counts above, `job_run` inventory, schema columns and markers.
Inferred: why 385 rows are stuck `pending` (code path plausible, not reproduced); production job cadence vs the local snapshot; detail-crawl duration estimate; which stages the owner treats as mandatory (my proposed hard-block list is a recommendation).
