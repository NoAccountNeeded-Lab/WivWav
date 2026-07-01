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
```

Always run against a live production database. The audit is read-only and
produces no mutations.

If Meilisearch credentials are set in the environment (`MEILISEARCH_URL`,
`MEILISEARCH_MASTER_KEY`), the audit will also check search index divergence.

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

### Search index divergence

Shows whether the number of active-eligible listings in the DB matches the
number of documents in the Meilisearch index.  A divergence of >0 is
unexpected after a successful `listing-sync` run.

If Meilisearch is unavailable, the field shows `null` with a note.

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
| Search index diverged from DB | listing-sync job failed or ran on stale data | Re-trigger listing-sync from `/ops/queues` |

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

These gaps are included in every audit report under `knownGaps`.
