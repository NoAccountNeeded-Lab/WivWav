# Vehicle Identity Backfill — Ops Runbook

This runbook covers the non-VIN vehicle identity backfill introduced in
[#532](https://github.com/NoAccountNeeded-Lab/WivWav/issues/532) as part of the
[#506 listing-accuracy program](https://github.com/NoAccountNeeded-Lab/WivWav/issues/506).

## Background

The non-VIN matcher (#529) identifies duplicate listings that share a stable
dealer identity (same dealer + stock number) or identical source URL. These are
auto-linked. Pairs that score above a conservative threshold but lack a stable
identifier are recorded as candidates for operator review.

Before enabling the live matcher job in production, this backfill lets operators
verify the expected auto-link and candidate volumes against existing listings —
without persisting any decisions in `--report` mode.

## Commands

```bash
# Read-only report (no writes):
pnpm tsx apps/scraper/src/jobs/vehicle-identity-backfill.ts --report

# Apply decisions for a single source (phased rollout):
pnpm tsx apps/scraper/src/jobs/vehicle-identity-backfill.ts --apply --source <sourceId>

# Apply decisions for all sources:
pnpm tsx apps/scraper/src/jobs/vehicle-identity-backfill.ts --apply
```

## Metrics to monitor

After each `--apply` run, check the following:

| Metric | Where to check | What to look for |
|--------|----------------|------------------|
| Auto-link count per source | `vehicle_identity_decision` table (`state = 'verified'`) | Should match `--report` auto-link total; large unexpected spikes indicate a data anomaly |
| Candidate count | `vehicle_identity_decision` table (`state = 'candidate'`) | Low-scoring candidates need operator review before auto-linking |
| Vehicle groupings in search | Meilisearch `listings` index, `vehicleId` facet | Auto-linked listings should share a `vehicleId`; verify groupings look correct |
| Representative listing selection | `GET /v1/vehicles/:id` | Representative listing (#530) should be a clean, complete listing for the vehicle |
| False-positive rate | Review `--report` false-positive sample | Spot-check borderline pairs against their source pages before applying |

## Phased enablement steps

1. **Run `--report` and review output.**
   - Confirm the auto-link rate looks plausible. A very high rate on one source
     (e.g. >10%) may indicate data issues (many listings sharing a stock number
     or URL), not genuine duplicates.
   - Review the false-positive sample carefully. Each low-scoring candidate
     pair should be checked against its source page before applying.
   - Confirm candidate counts are reasonable — a large number of candidates
     means many pairs need human review before auto-linking.

2. **Apply per-source, one at a time.**

   ```bash
   pnpm tsx apps/scraper/src/jobs/vehicle-identity-backfill.ts --apply --source <sourceId>
   ```

   After each source:
   - Check auto-linked decision counts in the database match the report.
   - Verify a sample of linked vehicle groups look correct (same physical vehicle).
   - Trigger a Meilisearch sync if needed:
     ```bash
     # Via the ops job queue or directly:
     pnpm tsx apps/scraper/src/jobs/meilisearch-sync.ts
     ```
   - Check representative listing selection for newly grouped vehicles.

3. **Apply to all sources once each per-source run looks clean.**

   ```bash
   pnpm tsx apps/scraper/src/jobs/vehicle-identity-backfill.ts --apply
   ```

4. **Re-run `--report` after the live `match-vehicle-identity` job has run.**
   This backfill only records `VehicleIdentityDecision` rows — it never sets
   `Listing.vehicleId`. The `--report` scope filter (`vehicleId = null`) therefore
   will not shrink until after the live job runs and assigns vehicleIds. Once the
   live job has processed the decisions, re-running `--report` should show a
   near-zero auto-link count (only new or previously-locked pairs remaining).

## Post-release smoke checks

After applying and syncing, verify:

- `vehicle_identity_decision` row count matches the `--report` totals
  (auto-linked + candidates).
- A direct DB query confirms no decisions have `state = 'verified'` with a
  null `vehicleId` (every auto-link should have a vehicle assigned by the live
  match-vehicle-identity job, not this backfill — the backfill records decisions
  only; the live job assigns vehicleIds).

  > **Note:** The backfill records decisions (`auto_link` → `verified`, `candidate` → `candidate`)
  > but does **not** assign `vehicleId` or update `Listing.vehicleId`. Use the live
  > `match-vehicle-identity` job for that step, which handles locking and vehicle creation.

- Search returns correct vehicle groupings for known duplicate listings.
- Representative listing selection (#530) shows a complete listing for each
  auto-linked vehicle group.
- No unexpected 404s on listings that were part of auto-linked pairs.
- Candidate decisions appear in operator review tooling for human review.

## Rollback

The backfill is idempotent — rerunning `--apply` with unchanged data is safe
(it uses `upsertVehicleIdentityDecision`, which is ON CONFLICT DO UPDATE).

To revert auto-linked decisions made within a run window without destroying
listing source data:

```sql
-- Step 1: Mark verified decisions from the run window as rejected.
-- Column names are camelCase — quotes are required.
UPDATE vehicle_identity_decision
  SET state = 'rejected'
WHERE "decidedAt" >= '<run-start>'
  AND "decidedAt" < '<run-end>'
  AND state = 'verified';

-- Step 2: Clear vehicleId on listings whose vehicleId was assigned by
-- these now-rejected decisions. This backfill never sets Listing.vehicleId
-- directly, so Step 2 is only needed if the live match-vehicle-identity job
-- also ran and used the decision rows to assign vehicleIds.
UPDATE listings
  SET "vehicleId" = NULL
WHERE "vehicleId" IN (
  SELECT DISTINCT "vehicleId"
  FROM vehicle_identity_decision
  WHERE "decidedAt" >= '<run-start>'
    AND "decidedAt" < '<run-end>'
    AND state = 'rejected'
    AND "vehicleId" IS NOT NULL
);
```

After rollback:
1. Trigger a full Meilisearch re-index to reflect updated vehicle groupings.
2. Verify search results look correct.
3. Leave listing rows, source observations, and vehicle rows in place.
   Only decision state and vehicleId assignments are reverted.

## Notes

- This backfill does **not** assign `Listing.vehicleId`. It only records
  `VehicleIdentityDecision` rows. The live `match-vehicle-identity` job uses
  those decisions (plus its own scoring) to actually assign vehicleIds and
  update listings.
- A false merge is worse than a visible duplicate. If in doubt about a
  borderline candidate, leave it as a candidate for manual review.
- The backfill only processes active listings with `vehicleId = null`. Listings
  already grouped by the VIN-based `deduplicate` job are excluded.
