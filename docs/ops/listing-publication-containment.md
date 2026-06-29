# Listing Publication Containment and Recovery

This runbook covers the data-quality containment started on 2026-06-29. It is
an incident workflow, not the normal scrape workflow.

## Current safety boundary

- PostgreSQL observations are evidence and must not be deleted.
- Every existing and newly observed listing defaults to `pending`.
- Only active listings explicitly marked `eligible` may enter public APIs,
  search, facets, cross-listings, or listing-derived analytics.
- A changed source observation, detail extraction, or VIN enrichment invalidates
  the prior decision and returns the row to `pending`.
- `quarantined` rows retain concise rule IDs in `qualityIssueCodes`.
- `qualityCheckedAt` records when the validator made its latest decision.
- Full search sync clears the listing index before adding eligible rows.
- Incremental sync deletes requested rows that are no longer active and eligible.

The publication state is a safety control. Do not bulk-update legacy rows to
`eligible` to make the site look populated.

## 2026-06-29 containment record

The pre-containment PostgreSQL custom-format dump is:

```text
/private/tmp/wivwav-pre-containment-20260629.dump
SHA-256 f3e098d4145173a3c4d36dcec382ebd5a57c62b157c62f38f3205a114d4656ef
```

`pg_restore --list` verified the dump. Copy it to durable encrypted storage
before cleaning the host's temporary directory.

Meilisearch task `6915` removed 5,521 legacy documents. The listing index was
then verified at zero documents.

The following listing-mutating or publication queues were paused:

- `source-scrape`
- `detail-crawl`
- `detail-extract`
- `geocode`
- `deduplicate`
- `vin-enrich`
- `listing-sync`
- `rawpage-cleanup`

Repeatable schedules were disabled for source scrape, detail crawl/extract,
geocode, deduplicate, VIN enrichment, and raw-page cleanup. The `listing-sync`
queue pause contains its existing nightly repeatable; this release adds that
schedule to Ops so it can also be disabled explicitly before rollout. Keep all
queues paused and keep the index empty throughout deployment of the
default-deny gate. NHTSA research queues do not publish listings and may remain
enabled.

## Deployment

1. Confirm the backup path, checksum, and restore listing above still verify.
2. Confirm all listed queues are paused. Disable every listing repeatable shown
   in Ops, including `listing-sync`.
3. Confirm the Meilisearch listing index contains zero documents.
4. Deploy the application and additive database migration.
5. Confirm the migration left every legacy row `pending`; the eligible count
   must be zero.
6. Restart API, scraper, web, and ops services as required, but do not resume
   listing queues or schedules.
7. Run the smoke checks below. Do not trigger listing sync merely to test it
   unless the eligible count is still zero.

The migration is intentionally non-destructive. It does not infer eligibility
from `status`, scraper success, field presence, or prior publication.

## Post-release smoke checks

Use the Ops Sources and Refresh Listings pages to verify observed and eligible
counts separately, then check the public application/API:

- Observed active rows remain present in PostgreSQL.
- Eligible listings are zero until the validator promotes a row.
- `GET /v1/listings` returns zero listings and empty listing facets.
- A direct `GET /v1/listings/:id` for a known pending or quarantined row returns
  404.
- Cross-listings, market pricing, and popular aggregations contain no pending or
  quarantined data.
- Meilisearch contains no pending or quarantined document.
- Queues and repeatable schedules listed above remain paused/disabled.

If any check fails, follow Rollback immediately.

## Recovery: validate a corpus, not the whole database manually

Do not delete PostgreSQL and do not manually rebuild every vehicle one at a
time. That would destroy comparison evidence, price/history relationships, and
the ability to measure whether fixes improved the data.

Use a controlled promotion workflow after
[#502](https://github.com/NoAccountNeeded-Lab/WivWav/issues/502) supplies the
validator:

1. Preserve source HTML and current rows as the shadow dataset.
2. Build a gold corpus:
   - validate every MobilityWorks listing because the set is small and its
     detail extraction failed systematically;
   - sample BLVD across dealer/private sellers, year/make/model, converter and
     ramp values, missing detail, invalid VINs, NHTSA conflicts, duplicates,
     missing locations, and stale/gone candidates;
   - include both known-bad rows and clean controls.
3. Run one listing at a time only during the pilot so each source page,
   normalized row, validator decision, and public document can be compared.
4. Fix extraction and validation until the corpus passes with no unexplained
   false promotion or quarantine.
5. Run the validator over the retained database as a shadow backfill. It must
   write `eligible` or `quarantined`, reason codes, and `qualityCheckedAt`
   explicitly and idempotently.
6. Review quarantine volume and rule rates by source. Do not promote unknowns
   merely to meet an inventory target.
7. Run a clean full listing sync and repeat the smoke checks with the expected
   eligible count.
8. Resume one source pipeline at a time. Verify observed, eligible, and
   quarantined deltas before resuming the next source.

## Rollback

1. Pause the listing queues and disable their repeatable schedules.
2. Clear the Meilisearch listing index and verify zero documents.
3. Roll back application services if necessary.
4. Leave the additive publication columns and PostgreSQL observations in place.
   Do not delete rows and do not bulk-promote them.
5. Restore the database dump only for confirmed database corruption or an
   explicitly approved point-in-time recovery. A normal application rollback
   does not require restoring it.
6. Keep the public listing index empty until the corrected release passes all
   smoke checks.
