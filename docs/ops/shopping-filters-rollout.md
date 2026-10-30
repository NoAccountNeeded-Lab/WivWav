# Shopping filter index rollout

Issue #1233 adds city/state pairs, normalized transmission, exact positive
wheelchair capacity (1–6), and proposed/complete/unknown conversion status.
These are projections of existing listing fields; no database migration is needed.
Raw transmission and location values remain on the listing rows. Missing or invalid
capacity is indexed as null, never zero. Unrecognized transmission is null.

## Deploy and verify before exposing controls

1. Deploy the API and web changes with `WAV_SHOPPING_FILTERS_ENABLED=false`
   (the default in both Compose files and `apps/api/.env.example`). Existing
   URLs continue to work. New-filter queries return `503 SEARCH_UNAVAILABLE`;
   facet responses advertise `shoppingFiltersReady: false`, so the web hides
   the four new controls. API startup refreshes settings, but that is **not**
   a document rebuild and does not establish readiness.
2. Trigger the existing authenticated `POST /admin/sync` operation, or the
   existing full-sync action in ops. The API's `listing-sync` worker runs
   `apps/api/src/jobs/meilisearch-sync.ts`. Do not clear the live index or
   substitute an incremental poll: unchanged listings must be remapped too.
3. Inspect the job run until it succeeds. The process waits for settings,
   every document batch, and the atomic swap task; it compares submitted and
   committed documents with the eligible, deduplicated database group count.
   Only **Verified index swap complete** means the new projection is live.
   A build-validation message or a 202 enqueue response is not completion.
4. Verify the live index has filterable `cityState`, `transmission`,
   `wheelchairCapacity`, and `conversionStatus`, and sample its documents:
   `springfield|IL` and `springfield|MO` must be separate values; transmission
   must use automatic/manual/cvt/automated_manual; capacity must be null or an
   integer 1–6; conversion status must preserve its existing meaning. Check
   populated and missing examples against source listing rows. Verify total
   reconciliation and that no Meilisearch task failed.
5. Before first enablement, the new cache namespace `facets:shopping-v3:held:`
   excludes all old `facets:eligible-v2:` payloads. Enabling switches again to
   `facets:shopping-v3:ready:`, excluding held pre-rebuild distributions.
   If this release has already been enabled in this environment, invalidate
   **all** `facets:shopping-v3:ready:*` keys using the deployment's established
   Valkey operations, or hold the gate off for the configured
   `facets.cache_ttl_s` lifetime before re-enabling. Do not use `FLUSHDB`:
   Valkey also contains job queues and unrelated cached data.
6. Set `WAV_SHOPPING_FILTERS_ENABLED=true` in the API deployment environment
   and recreate the API service using the normal deployment workflow.
   Verify `/v1/listings/facets` now returns `shoppingFiltersReady: true` and
   city/transmission/capacity/status breakdowns. Compare exact filtered
   `/v1/listings` totals to facets using identical constraints. Check same-name
   cities, two city/state pairs without cross-product matches, explicit state
   conflicts returning zero matches, unknown conversion status, and null capacity.
7. Smoke-test Discover → results → vehicle, direct legacy URLs, chip removal,
   keyboard use, and disjunctive counts. A city that conflicts with an explicit
   state remains selected and removable; neither constraint is silently dropped.
   Malformed capacity, including 0, 7, fractions and trailing commas, must get 400.
   During search outages listings still return 503 without a database fallback.

The gate is an operator cutover, not an automatic inference from a non-empty
facet response. Do not enable it until the full job and smoke checks above pass.
No production rebuild or enablement is performed by the implementation tests.

## Rollback

The established search projection rollback is application rollback plus a full
rebuild from authoritative PostgreSQL, as in the
[vehicle identity backfill runbook](vehicle-identity-backfill.md#rollback).
The rebuild deletes the previous index after a successful swap; it does **not**
retain a durable previous-index backup. Do not promise a reverse swap after cleanup.

1. Disable `WAV_SHOPPING_FILTERS_ENABLED` and recreate the API. New-filter
   direct links fail closed with 503; old URLs remain supported. Remove the new
   filters through their chips to recover a legacy search.
2. Roll back the API/web application images using the normal deployment
   workflow. No source listing/schema rollback is required for this additive
   projection. Existing old readers can ignore extra index document fields.
3. Trigger the same existing full-sync operation under the restored API and
   verify its completed swap and count reconciliation. Failed settings, document
   tasks, or count validation leave the current live index intact; failed swap
   tasks must never be reported as completion.
4. Invalidate the affected facet-cache namespace (or wait its configured TTL)
   and smoke-test legacy search, facets and a representative vehicle detail.
   Before retrying this release, repeat the full rollout and ready-cache
   invalidation; never re-enable on the strength of a prior successful run.

## Automated proof

- `packages/types/src/shopping-filters.test.ts`: normalization, pair identity,
  missing/invalid capacity and both bounds.
- `packages/search/src/index.test.ts`: document mapping, raw-source preservation,
  null capacity and awaited filterable settings.
- API listing/search/facet tests: strict query validation on both endpoints,
  exact numeric OR membership plus AND constraints, gate hold/enable, cache
  namespace transition and aggregate breakdowns.
- `apps/api/src/jobs/meilisearch-sync.test.ts`: versioned build/swap, count
  reconciliation, awaited completion, failed batches/swap and live-index safety.
- Web URL/chip/chart tests: old URL round trips, all new filter forwarding,
  selected zero-count conflicting cities, individual removal and disjunctive
  requests retaining unrelated mobility/state constraints.
