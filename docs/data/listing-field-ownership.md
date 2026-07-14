# Listing field ownership and refresh semantics

This document defines which pipeline stage may replace each mutable `Listing`
field. A stage may record evidence for a field owned by resolution, but it must
set `publicationStatus = pending`; it must not promote its latest string to
verified public truth.

## #499 claim/evidence resolution (conversionType, rampType)

Card and detail extraction each persist their observed value directly on the
`Listing` row (as before) **and** record an independent, append-only claim in
`ListingFieldClaim` (`apps/scraper/src/resolution/claims-repository.ts`).
Every write path then recomputes the field's resolution from every stored
claim — including any photo-derived claim from a `PhotoClaimProvider`
(`apps/scraper/src/resolution/photo-claim-provider.ts`, a no-op until #129
supplies a real classifier) — via the pure resolver in
`apps/scraper/src/resolution/resolver.ts`, and writes both the resolved
normalized value and a separate `conversionTypeResolution`/
`rampTypeResolution` (`FieldResolutionState`: `verified` | `source_reported` |
`conflicting` | `unknown`) back onto the row in the same transaction.

`conflicting` is a resolution state, never a value: while conflicting, the
resolver writes `unknown` to `conversionType`/`rampType` itself, which is what
actually excludes the listing from side/rear and ramp-type search
filters/facets (see `packages/search/src/index.ts::toDocument`) — no
additional filter rule is needed. `GET /v1/listings/:id` mirrors this in
`fieldResolution: { conversionType, rampType }` and defensively re-forces the
public `wav` value to `unknown` while conflicting.

Integration points, each gated on "this stage actually observed a value" so
untouched listings never write to `ListingFieldClaim`:
- Card: `apps/scraper/src/resolution/card-claims.ts`, called from
  `PrismaListingRepository.upsert` after `ingestListing` commits.
- Detail: `apps/scraper/src/resolution/detail-claims.ts`, called from
  `detail-extract.ts` when the description was actually observed.
- Backfill (pre-#499 data): `apps/scraper/src/jobs/field-claims-backfill.ts`
  seeds one claim from the currently-stored value for a listing with no claim
  history yet — see that file's module docstring for the full deploy
  procedure and why it can only ever produce `source_reported`, never
  `conflicting`.
- Operator triage: `GET /admin/field-conflicts`
  (`apps/api/src/repositories/listing-repository.ts::findFieldConflicts`).

## Ownership matrix

| Fields | Storage owner | Refresh rule |
| --- | --- | --- |
| `sourceId`, `sourceRecordKey` | list/card scrape | Immutable source identity used by the unique key. A corrected identity creates a distinct source record; fuzzy merging is out of scope. |
| `sourceUrl`, source fallback `buyerUrl`, `externalId`, `stockNumber` | list/card scrape | Replace when the card changes. A dealer-enriched direct `buyerUrl` is preserved when the card only repeats its source URL. |
| `make`, `model`, `year`, `trim`, `vin`, `condition`, `sellerType` | list/card scrape, then resolution | Persist corrected card evidence and move publication to `pending`. VIN enrichment may link the resulting VIN to `vehicleId`, but does not rewrite the observed VIN. Resolution owns public conflict decisions (#499). |
| `priceCents`, `mileage` | list/card scrape | Replace on change. Non-null transitions append their specialized history rows in the same serializable transaction. |
| `conversionType`, `rampType` | resolution (see "#499 claim/evidence resolution" above) | Card and detail stages each persist an independent claim; the resolver, not either stage, owns the final normalized value and its `conversionTypeResolution`/`rampTypeResolution` state. |
| `conversionManufacturer`, `conversionStatus`, `wavFeatures`, `floorLoweringInches`, `wheelchairCapacity` | resolution | Card and detail stages persist real bounded observations and invalidate publication. Card absence sentinels preserve existing detail/resolved evidence. The #502 validator owns publication eligibility; neither scraper stage marks the row eligible. |
| `color` | list/card scrape, then detail scrape | A corrected card color is persisted; bounded detail specifications may refine it. Missing detail evidence preserves the card value. |
| `fuelType`, `engine`, `transmission` | detail scrape | Replace only when the bounded specification extraction succeeded. Missing/failed extraction preserves the previous value. |
| `zip`, `city`, `state` | list/card scrape | Replace on change and clear `lat`/`lng`, forcing geocoding to recompute coordinates. Detail may supply a bounded ZIP observation. |
| `lat`, `lng` | geocode | Never overwritten by a card unless source location changes, in which case both are cleared. |
| `dealerName` | list/card scrape | Replace corrected source dealer identity. |
| `dealerPhone` | detail scrape | Replace only from bounded detail evidence. Missing evidence preserves the prior value. |
| `dealerWebsite`, direct `buyerUrl`, `dealerProfileId` | dealer enrichment | Enriched values survive source fallback observations. |
| `cardImages` | list/card scrape | Exact card image input, including an empty card image list. This is retained separately from the verified detail gallery. |
| `images` | detail scrape | A changed verified gallery replaces the array; a verified empty gallery clears it; missing/failed gallery extraction preserves it. |
| `description` | detail scrape | A value replaces it, a verified empty bounded section clears it, and missing/failed extraction preserves it. |
| `saleStatus`, `soldAt` | detail scrape / resolution | Bounded sale banners update status. First sold confirmation sets `soldAt`; retries do not rewrite it. |
| `status`, `goneAt`, `missingFromCompleteCount`, `lastSeenInCompleteCrawlAt` | resolution | Source-index absence and bounded detail status evidence use the documented gone-state resolver. |
| `publicationStatus`, `qualityIssueCodes`, `qualityCheckedAt` | resolution | Any changed source/detail/accessibility observation sets `pending`; only the validator/resolver may set `eligible`. Accessibility changes also enqueue `listing-resolve`, the #499 handoff. |
| `vehicleId`, `vehicleModelId`, `vehicleModelMatchConfidence` | VIN enrichment | Updated from normalized VIN/model evidence without rewriting source observations. |
| `isDuplicate`, `canonicalId` | resolution | Owned by deduplication/canonical resolution. |
| `detailScrapedAt` | detail scrape | Time the most recent raw page was successfully interpreted, even when its values were unchanged. |
| `listedAt` | list/card scrape | WAV Search first-seen timestamp, set once on create from the scrape clock. It is not a seller listing date. Search ordering, “New” badges, crawl ordering, and observed-inventory history intentionally use this internal discovery time. |
| `sourceListedAt`, `sourceUpdatedAt` | detail scrape | Explicit seller/source dates from listing-scoped structured metadata. Valid values replace prior source values; missing or invalid metadata preserves them. Seller-age and time-to-gone metrics use `sourceListedAt` and exclude rows where it is unavailable. |
| `scrapedAt` | list/card scrape | Time the most recent **changed** card observation was committed. Unchanged cards do not churn rows; source-level `lastObservedAt` records successful no-change checks. |
| `processingLockedAt` | resolution | Ephemeral job lock only. |
| `updatedAt` | database | Prisma-managed write timestamp. |

### Listing date audit

`listedAt` remains in public responses for compatibility, but its contract is
WAV Search first observation. It must be labeled “WAV Search first saw” (or an
equivalent internal-discovery label), never “seller listed.” `updatedAt` is a
database write timestamp and is not a seller update date. Detail and legacy
listing UIs prefer `sourceListedAt`/`sourceUpdatedAt` when present and otherwise
label WAV Search timestamps explicitly. Search's `listedAt` sort and “New” badge
remain accurate because they describe when WAV Search discovered the record.

## Evidence and idempotency

`listing_observation` stores the stage, raw-page reference when available,
extraction version, observation time, changed field names, and compact
before/after values. Detail evidence has three states:

- `value`: a bounded selector found a value;
- `authoritative_empty`: the bounded container was verified and empty, so the
  existing value may be cleared;
- `missing`: the container/evidence was absent or extraction failed, so the
  existing value must be preserved.

Card accessibility fields use equivalent absence semantics until adapters emit
explicit field evidence: `rampType: unknown`, `wavFeatures: []`,
`floorLoweringInches: null`, and `wheelchairCapacity: null` mean `missing` and
preserve the existing value. A non-placeholder card value is committed, moves
publication to `pending`, and retains the replaced detail/resolved value in the
observation's `before` payload for the resolution path.

Each detail raw-page version has a unique `(stage, rawPageId:scrapedAt)` observation. A job retry
therefore does not apply it twice. `searchSyncedAt` records the completed index
task submission; a retry only repeats search sync when the committed observation
has not yet submitted its Meilisearch update.
Card writes run in a serializable transaction; transaction conflicts and
concurrent creates are retried, then re-read, so the losing worker observes the
committed value as unchanged. History and audit rows commit with the listing.

Changed card rows reset `detailScrapedAt` when the correction can affect detail
data. An unchanged row creates no history, observation, detail work, or search
sync. Scraper-run counters mean:

- `listingsFound`: cards accepted from the source in this run;
- `listingsNew`: previously unseen source keys committed;
- `listingsUpdated`: existing rows with at least one committed field change.

## Backfill and release plan

1. Deploy the additive migration (`cardImages` and `listing_observation`) before
   scraper workers. Old application code is compatible with both additions.
2. Deploy workers, pause scheduled source jobs, and force one complete source
   scrape per active source. The scrape stores current card inputs, requeues
   changed details, and reports `listingsNew`/`listingsUpdated`.
3. Drain detail extraction and the #499 validator/resolver, then run one full
   listing-sync reconciliation. Resume schedules after pending counts stabilize.
4. Record per-source/per-field repairs from the audit table:

```sql
SELECT s.name AS source, field, count(*) AS changed
FROM listing_observation o
JOIN listings l ON l.id = o."listingId"
JOIN sources s ON s.id = l."sourceId"
CROSS JOIN LATERAL unnest(o."changedFields") AS field
WHERE o."observedAt" >= :deployment_time
GROUP BY s.name, field
ORDER BY s.name, changed DESC;
```

Rollback is application-first: stop workers, deploy the previous worker image,
and leave the additive columns/table in place. Do not reverse already corrected
listing values. If a source parser is bad, quarantine that source, restore
affected fields from `listing_observation.before`, set rows to `pending`, rerun
the resolver, and reconcile search. The additive migration can be dropped only
after all old workers are restored and audit retention is no longer required.

Post-release smoke queries:

```sql
-- changed rows and the resolver backlog by source
SELECT s.name, l."publicationStatus", count(*)
FROM listings l JOIN sources s ON s.id = l."sourceId"
GROUP BY s.name, l."publicationStatus" ORDER BY s.name;

-- duplicate detail application must remain empty
SELECT stage, reference, count(*)
FROM listing_observation
WHERE reference IS NOT NULL
GROUP BY stage, reference HAVING count(*) > 1;

-- changed locations awaiting geocoding
SELECT count(*) FROM listings
WHERE status = 'active' AND (zip IS NOT NULL OR city IS NOT NULL)
  AND (lat IS NULL OR lng IS NULL);

-- search reconciliation: compare this eligible count with listing-sync output
SELECT count(*) FROM listings
WHERE status = 'active' AND "publicationStatus" = 'eligible';
```
