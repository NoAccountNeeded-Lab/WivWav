# Runbook: Listing Quality Audit

This runbook explains how to run the listing quality audit, interpret each
metric, investigate representative examples, approve a new baseline, and
respond to a failed gate.

---

## When to run

- After any significant scraper change (new source, parser refactor, schema migration).
- On a scheduled cadence (recommended: weekly, via cron on the ops server).
- After a source quality alert is triggered (drift threshold exceeded).
- Before a new gold dataset is promoted to production.

---

## Running the audit

```bash
# Human-readable output (default)
pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report

# Scope to a single source
pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report --source blvd

# Machine-readable JSON to file
pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report --json --out audit-$(date +%Y%m%d).json

# Limit scan for quick spot-checks (does not produce a representative baseline)
pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report --limit 500

# Compare against a previously approved coverage baseline (search reconciliation)
pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report --baseline search-baseline.json

# Approve the current coverage/unknown-rates as the new baseline after a
# deliberate schema or canonicalization change
pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report --approve-baseline search-baseline.json

# Tune how large a coverage-rate drop (0–1, absolute) triggers a baseline alert (default 0.1)
pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report --baseline search-baseline.json --coverage-drop-threshold 0.15
```

Always run against a live production database. The audit is read-only and
produces no mutations, against both Postgres and Meilisearch.

Search index reconciliation (see below) uses `MEILI_HOST` / `MEILI_API_KEY`
(the same environment variables the rest of the app uses) and the queue
backend's standard `QUEUE_REDIS_URL` / `VALKEY_URL`. It is skipped —
correctly, not silently — whenever `--source` scopes the audit, since a
verified vehicle group can span more than one source and a per-source
reconciliation would report false divergence.

---

## Interpreting each metric

### Overview

| Metric | What it means |
|---|---|
| Total active listings | All listings with `status = active`, regardless of publication status |
| Total all statuses | All listings including `possibly_gone` and `gone` |

### Per-source

| Metric | What it means | Alert threshold |
|---|---|---|
| Active | Listings still observed in the source as of the last scrape | Sharp drop may mean scraper is broken |
| Eligible (public) | Listings that have passed the validation gate and can appear in search | Should be > 90% of active under normal operation |
| Quarantined | Failed the publication gate; not shown to users | See quarantine code breakdown to diagnose |
| Pending | Not yet validated (normal for newly scraped listings) | Should trend to zero within 24h after validation runs |
| No-VIN active | Active listings without a usable VIN | High rate limits cross-source identity matching |
| Stale detail (>14d) | Active listings whose detail page has not been scraped in 14+ days | Check detail-crawl queue if count is high |
| A11y conflicts | Listings quarantined for `unsupported_accessibility_claim` | Should be 0 with no AI hallucinations |
| Duplicates | Listings with `isDuplicate = true` (same VIN seen on multiple sources) | Expected to be > 0; high rates merit investigation |

### Field completeness rates

Rates show the proportion of active listings where each field is present and
non-null.  Expected minimums under normal operation:

| Field | Expected minimum |
|---|---|
| make, model, year | 100% (parser rejects cards without these) |
| vin | Varies by source. blvd: ~80% (FSBO listings may lack VIN); mobilityworks: ~95% |
| conversionType | 100% (always set, may be 'unknown') |
| rampType | 100% (always set, may be 'unknown') |
| images | >90% |
| priceCents | >80% (Call-for-price reduces this) |
| mileage | >85% |
| state | >90% |
| description | Populated after detail extraction; 0% for newly scraped card-only listings |

### Unknown-value rates

Shows the proportion of active listings where enum fields have value
`'unknown'`.  Acceptable ranges:

| Field | Acceptable unknown rate |
|---|---|
| conversionType | <30% for blvd; <20% for mobilityworks (conversion field is structured) |
| rampType | <40% (only populated from description text; may be absent) |

Rates above these values indicate a parser degradation or a structural change
on the source website.

### Quarantine code breakdown

Lists the specific `qualityIssueCodes` emitted by the publication validator.
A single code appearing on a large percentage of listings usually means:
- `missing_required_field` → parser is failing to extract a required field; check recent scraper changes.
- `unparseable_vin` → VIN extraction logic broke; check URL slug pattern for the source.
- `unsupported_accessibility_claim` → AI agent is emitting a WAV feature without corroborating evidence.
- `nhtsa_make_mismatch` / `nhtsa_model_mismatch` → NHTSA lookup is disagreeing with scraped fields; may be a data model normalization issue.

### Image clusters

| Metric | What it means |
|---|---|
| Exact-duplicate clusters | Groups of identical images (same SHA-256) across listings |
| Near-duplicate clusters | Groups of visually similar images (pHash within threshold) |
| Placeholder clusters | Clusters reused across >N listings, likely stock photos |
| Cross-vehicle clusters | Same image on multiple vehicles — highest concern for photo accuracy |

Zero values here mean the `image-integrity-backfill` job has not been run yet.
Run it first:

```bash
pnpm tsx apps/scraper/src/jobs/image-integrity-backfill.ts --apply
```

### Search index reconciliation (#642)

Reconciles the *expected* search catalog — every eligible active listing
grouped by verified vehicle group, with the same deterministic
representative-selection policy production indexing uses (`groupKeyOf` /
`selectRepresentative` / `toDocument` from `@wivwav/search`) — against the
*actual* documents currently in Meilisearch, across every public facet: make,
model, trim, year, price bucket, mileage bucket, state, condition,
conversion type, color, ramp type, seller type, conversion brand, and WAV
features.

This replaces the pre-#642 check, which compared the raw count of eligible
listing *rows* against the Meilisearch document count. Search holds exactly
one representative per verified vehicle group, so that comparison
over-counted whenever any group had more than one eligible member — it could
report "divergence" during entirely normal operation while missing a real
defect (e.g. #636) that puts more than one representative for the same group
in the index.

| Field | What it means | Alert threshold |
|---|---|---|
| `expectedTotal` / `actualTotal` | Expected representative count vs. live index document count | Any mismatch is unexpected after a successful `listing-sync` run |
| `missingFromIndex` | Expected representative ids absent from the index entirely | >0 means the indexer poller (#669) has a stalled or failed batch — check `searchIndexerCheckpoint` |
| `unexpectedInIndex` | Documents in the index with no corresponding expected representative | >0 means a stale or orphaned document — usually a listing that became ineligible without a subsequent sync |
| `duplicateVehicleIds` | More than one document in the index sharing the same non-null `vehicleId` | Always a bug — `distinctAttribute` only dedupes at *search* time, it does not prevent duplicate documents; investigate `syncListings` (refs #636) |
| `canonicalizationDivergenceSamples` | Documents present on both sides whose field value differs from what current canonicalization would produce | Indicates a stale index entry — a raw source value or the canonicalization/alias table changed since the last sync |
| `facetComparisons` | Per-facet value-set and count comparison between expected and actual distributions | A diverged required facet (see below) is always a bug; a diverged optional facet may just mean the index is temporarily behind a fast-moving DB |
| `invariantViolations` | Required facets (make, model, year, condition, sellerType, conversionType, rampType) missing on an expected document, or a duplicate-vehicleId group | Always investigate — required facets are never legitimately absent |
| `coverage` / `unknownRates` | Global and per-source ratios for optional facets (trim, color, state, price/mileage bucket, conversionBrand) and the `unknown` sentinel rate on conversionType/rampType | Informational unless `coverageDropAlerts` fires — sparse optional data is normal |
| `coverageDropAlerts` | Coverage/unknown-rate entries that dropped by ≥ `--coverage-drop-threshold` (default 0.1) vs. the supplied `--baseline` | A sudden per-source drop usually means a parser regression on that source |
| `publicationBacklog` | `pending` / `quarantined` listing counts and the `listing-resolve` queue's waiting+active+delayed job count | A rising `listing-resolve` backlog means resolution is stalled — eligible listings are not reaching the index at all |

If Meilisearch is unavailable, `available` is `false`, `actualTotal` is
`null`, and every index-dependent field is empty — required-facet invariant
violations are still computed against the expected (Postgres-only) catalog.
If the `listing-resolve` queue backend is unreachable,
`publicationBacklog.listingResolveBacklog` is `null` rather than blocking the
rest of the audit (bounded by an internal timeout so a down queue can never
hang the audit).

#### Interpretation

- **`expectedTotal` ≠ `actualTotal` with no missing/unexpected/duplicate
  entries**: transient — the indexer poller (#669) lags the DB by design;
  re-run the audit after its next tick.
- **`missingFromIndex` > 0**: the indexer poller has not yet — or has failed
  to — sync these representatives. Check `/ops/queues` for the
  `listing-index-poll` queue and the `searchIndexerCheckpoint` row.
- **`unexpectedInIndex` > 0**: a listing became ineligible (quarantined, gone,
  no longer the group representative) without a corresponding delete. Confirm
  the listing's current `publicationStatus`/`status`, then re-trigger sync for
  its id.
- **`duplicateVehicleIds` non-empty**: a `syncListings` defect left more than
  one representative for a group in the index — this is the class of bug
  #636 fixes. Do not resolve by deleting index documents by hand; fix the
  underlying sync defect first, or a subsequent sync may reintroduce it.
- **`canonicalizationDivergenceSamples` non-empty**: either the raw source
  data changed or the canonicalization/alias table (`packages/search/src/canonicalize.ts`)
  changed since these documents were last synced. Confirm which, then remediate
  per below.
- **`invariantViolations` non-empty for a required facet**: a data-integrity
  bug upstream of search — a required field is null on an eligible listing.
  This should be caught by the publication validator; if it wasn't, treat it
  as a validator gap, not a search-layer issue.
- **`coverageDropAlerts` fires for one source only**: a parser regression on
  that source, not a global change — check recent scraper commits for that
  source.
- **`publicationBacklog.listingResolveBacklog` rising steadily**: the
  `listing-resolve` worker is stalled or falling behind; eligible listings
  are stuck at `pending` and will never reach search until it drains.

#### Remediation

1. **Stale/missing/unexpected documents**: re-trigger the incremental
   indexer for the affected ids, or if widespread, run a full-rebuild sync
   (`LISTING_SYNC` queue with the `LISTING_SYNC_REBUILD_JOB_ID`, see
   `packages/search`/`apps/scraper/src/jobs/meilisearch-sync.ts`) to force a
   clean re-derivation of every representative from current Postgres state.
2. **Duplicate vehicleId documents**: identify and fix the `syncListings`
   defect that let a non-representative member survive a sync, then run a
   full-rebuild sync to remove the stray documents — do not delete them by
   hand from a partial understanding, since the same defect will reintroduce
   them on the next incremental sync.
3. **Canonicalization divergence**: if caused by an alias-table change,
   run a full-rebuild sync so every document picks up the new canonical
   values. If caused by unexpected raw source drift, file a fixture/parser
   fix first, then re-sync.
4. **Invariant violations**: fix the underlying validator/extraction gap
   that let a required field go null on an eligible listing; the search
   layer cannot repair this since `toDocument()` only transforms what
   Postgres already has.
5. **Backlog stalls**: check `/ops/queues` for the `listing-resolve` queue;
   restart the worker or clear a poison job (see `qualityIssueCodes` on the
   stuck listings) as appropriate.

#### Rollback

If a full-rebuild sync itself introduces new divergence (e.g. a bad
deploy), the rebuild target index is versioned and swapped only on success
(refs `docs/architecture/decisions/0001-search-projection-mechanism.md`) —
re-point the live alias back to the previous versioned index rather than
attempting to patch documents in place, then re-run this audit against the
restored index before re-attempting the rebuild.

#### Post-rebuild verification

After any full-rebuild sync (or a fix for one of the above), re-run:

```bash
pnpm tsx apps/scraper/src/jobs/listing-quality-audit.ts --report --json --out post-rebuild-audit.json
```

and confirm `searchReconciliation.countDivergence` is `false`,
`missingFromIndex.count` / `unexpectedInIndex.count` / `duplicateVehicleIds`
are all `0`/empty, and no `facetComparisons` entry for a required facet is
diverged, before approving a new baseline with `--approve-baseline`.

---

## Investigating representative examples

1. **Get the listing ID** from a sample list (e.g. `noVinSamples`,
   `staleDetailSamples`).
2. **Open the operator UI** at `/ops/listings/{id}` to see full field values,
   quality issue codes, and observation history.
3. **Inspect the source URL** — the `sourceUrl` field links to the original
   dealer page.  If the page is still live, compare it to the DB fields.
4. **Check observation history** — `ListingObservation` rows track when each
   scrape happened and what schema version was in use.
5. **Re-run detail extraction** — if `detailScrapedAt` is stale, queue the
   listing for fresh detail extraction via the detail-extract job.
6. **File a fixture** — if the field value is wrong, add a new case to the
   relevant gold fixture file and open a PR.

---

## Approving a new baseline

A "baseline" is the set of aggregate metrics (field completeness rates,
unknown rates, quarantine rates) that are considered normal for each source.
The listing-validator's `detectSourceDrift` function compares each scrape run
against the source's rolling baseline (stored in a `ConfigEntry`).

**To approve a new baseline after a deliberate schema or parser change:**

1. Run the audit with `--json --out baseline-YYYY-MM-DD.json`.
2. Review the report and confirm the new rates reflect the intended behavior
   (not a regression).
3. In the operator UI, navigate to `/ops/sources/{sourceId}` and use the
   "Reset drift baseline" action to reset the EWMA baseline to the current
   observed rates.
4. Archive the JSON file for 90 days per the evidence retention policy.

---

## Responding to a failed gate

A "failed gate" is when the audit reveals a metric outside its acceptable
range.  Common failure patterns and responses:

| Failure | Likely cause | Response |
|---|---|---|
| Active listings dropped >20% overnight | Scraper returned empty result; `needs_remapping` source status | Check `/ops/sources` for error state; inspect scraper logs |
| Eligible rate dropped to <50% | Validation job failing; schema change broke a required field | Run validation job manually; check for new `missing_required_field` codes |
| No-VIN rate rose above 50% | URL slug pattern changed on the source; VIN no longer in URL | Update parser; add gold fixture case |
| Stale detail count rose rapidly | detail-crawl queue is stalled or rate-limited | Check `/ops/queues`; restart or tune the detail-crawl job |
| `unsupported_accessibility_claim` count nonzero | AI agent emitting unverified WAV features | Check AI agent prompt; verify model version; add test case |
| Image placeholders > 10% | Source serving stock photos for sold/missing vehicles | Investigate with image-integrity-backfill report; may need image filter update |
| `searchReconciliation.countDivergence` / missing / unexpected documents | listing-sync/indexer poller failed or ran on stale data | Re-trigger the indexer poller or a full-rebuild sync from `/ops/queues` |
| `duplicateVehicleIds` non-empty | `syncListings` left a stale non-representative document in the index | Fix the sync defect, then run a full-rebuild sync |
| A required facet diverged or has an invariant violation | Validator gap let a required field go null on an eligible listing | Fix the publication validator; search cannot repair this |
| `coverageDropAlerts` fires for a single source | Parser regression on that source | Check recent scraper commits for the source; add a gold fixture case |
| `publicationBacklog.listingResolveBacklog` rising | `listing-resolve` worker stalled | Check `/ops/queues`; restart the worker |

---

## Running gold dataset regression tests

Gold dataset tests run in CI as part of the standard test suite:

```bash
pnpm test
```

To run only the gold tests:

```bash
pnpm --filter @wivwav/scraper test src/sources/blvd.gold.test.ts
pnpm --filter @wivwav/scraper test src/sources/mobilityworks.gold.test.ts
```

### Adding a new gold case

1. Observe a live listing or a bug report that reveals a new parsing edge case.
2. Construct the minimal `input` object (RawCard or RawDetail fields only).
3. Run the parser locally to confirm the expected output.
4. Add the case to the relevant `*.gold.json` file with a new unique `id`,
   accurate `tags`, and a `notes` field explaining why this case matters.
5. Run the gold tests to confirm the new case passes.
6. If the parser is wrong, fix the parser **and** the gold fixture together
   in the same PR so both are consistent.

### Promoting a live listing to a regression fixture

1. Find a live listing that exercises the edge case (e.g. from an audit
   sample list).
2. Record the raw card/detail fields (not the full HTML) as the `input`.
3. Verify the current DB values against the live page and confirm they are
   correct.
4. Add the case with the confirmed expected values and `evidenceRef` pointing
   to the source URL and verification date.

---

## Known gaps (as of initial audit)

The following dimensions cannot yet be measured by the audit and require
follow-up work before they can be gated:

- **VIN/NHTSA field-level mismatch rate** — measured indirectly via
  `nhtsa_*_mismatch` quality codes but not yet surfaced as a rate.
- **Cross-source identity duplicates** — requires `VehicleIdentityDecision`
  rows; run `match-vehicle-identity` job first.
- **WAV feature false-positive rate** — requires a human-reviewed label set
  beyond the current gold fixtures.
- **User-reported quality signals** — will be added when issue #147 lands.
- **Search reconciliation scoped to a single source** — skipped when
  `--source` is passed, since a verified vehicle group can include members
  from more than one source; only an unscoped run rebuilds the expected
  catalog correctly.

These gaps are included in every audit report under `knownGaps`.
