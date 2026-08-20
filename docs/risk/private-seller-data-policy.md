# Private-Seller Personal Data Policy

Reviewed: 2026-08-20
Status: **Implemented with counsel-review deferral** (see section below)
Follow-up from: #138, #336, #817

---

## Scope

A private-seller listing is any listing where `sellerType = 'private'` in the database. The only current source producing private-seller rows is BLVD.com, which classifies "For Sale By Owner" cards on the `/wheelchair-vans-for-sale-by-owner` path as private-seller inventory.

---

## Data Inventory

The following fields are ingested, indexed, stored, or displayed for private-seller listings:

### Ingest (scraper → database)

| Field | Source | Sensitivity | Notes |
| --- | --- | --- | --- |
| `sourceUrl` | BLVD listing URL | Low | Public URL of the listing page. Stored for deduplication and source attribution. |
| `buyerUrl` | Same as `sourceUrl` for BLVD | Low | Displayed as a "Contact seller" link. |
| `externalId` | BLVD `data-id` attribute | Low | Internal BLVD ID, not personal data. |
| `vin` | Last path segment of `sourceUrl` | Medium | VIN is public vehicle data but links to a specific vehicle. Stored and indexed. |
| `make`, `model`, `year`, `trim` | Card title | Low | Vehicle facts. |
| `condition` | Card badge | Low | |
| `priceCents` | Card price field | Low | |
| `mileage` | Card miles field | Low | |
| `city`, `state` | Card location field | Low | City/state only from the listing card. |
| `images` | Card thumbnail URL | Low–Medium | Could include photos taken at a private seller's home. |
| `sellerType` | Derived from seller field being "For Sale By Owner" | — | Classification field, not personal data itself. |

### Detail extraction (detail-crawl + detail-extract → database)

Detail extraction is performed by `apps/worker/src/handlers/detail-extract.ts`, using the parser in `packages/scraper-sources/src/sources/blvd-detail.ts`, for all listings regardless of seller type. For private-seller listings this can add:

| Field | Source | Sensitivity | Notes |
| --- | --- | --- | --- |
| `dealerPhone` | `tel:` link on detail page | **High** | For a private seller this is a personal phone number, not a business number. |
| `zip` | Seller sidebar address block | Medium | Narrows location to ZIP code level. |
| `description` | Free-text "Vehicle Description" block | Medium | May contain personal context (seller name, contact preferences, home location hints). |
| `images` | Gallery `_large.jpg` links | Low–Medium | Full-resolution images may reveal location metadata or home identifiers. |
| `color`, `fuelType`, `transmission` | Spec table | Low | |
| `rampType`, `hasLift`, etc. | Derived from description text | Low | WAV-specific features. |

### Meilisearch index (`packages/search/src/index.ts`)

The `toDocument` function maps all listing fields to the search index. Searchable attributes include `description` (free-text). Filterable attributes include `sellerType`. The full `dealerPhone` field was present in the indexed document before this issue was resolved.

### API response (`apps/api/src/routes/listings.ts`)

The detail endpoint returns `dealer.phone` (mapped from `dealerPhone`) for all listings. Before this issue, that exposed a personal phone number for private-seller listings.

The search endpoint returns `ListingDocument` hits directly from Meilisearch, which previously included `dealerPhone` for all listings.

### Web UI (`apps/web/src/components/listing/DealerCard.tsx`)

`DealerCard` renders `dealer.phone` as a clickable `tel:` link for all seller types including private sellers.

---

## Policy Decisions

### Phone number — suppress for private sellers (implemented)

**Decision:** Suppress `dealerPhone` in API responses and Meilisearch documents for listings where `sellerType = 'private'`.

**Rationale:** A private seller's phone number is personal data under CCPA (California Consumer Privacy Act) and similar state laws. Displaying and indexing it without the seller's consent to a commercial aggregator is the highest-risk individual field. This mitigation is implemented in `apps/api/src/routes/listings.ts` (detail response) and `packages/search/src/index.ts` (search index document).

**Implementation:** `toListingDetailResponse` in `listings.ts` nulls out `dealerPhone` when `sellerType === 'private'`. `toDocument` in `packages/search/src/index.ts` does the same for the search index.

### Description text — do not suppress (deferred)

**Decision:** Description text is currently returned from the API and indexed as a searchable field. Suppression for private sellers is **deferred** pending counsel review.

**Rationale:** Description text may contain personal context but also contains WAV-specific details that are useful for buyers. The text is already publicly visible on BLVD.com. A product decision to suppress it would require changes to the search index settings and API response. This is a private-seller privacy question independent of the BLVD/MobilityWorks source posture (resolved 2026-08-19, not a launch blocker) and remains deferred pending counsel review.

**Required action:** Product and counsel to decide whether private-seller description text should be (a) excluded from the search index, (b) returned in API but not indexed as searchable, or (c) retained as-is.

### VIN — retain

**Decision:** VIN is retained and indexed for all listings including private-seller listings.

**Rationale:** VIN is a vehicle identifier, not a person identifier. It is publicly visible on the vehicle, in title documents, and on the BLVD listing page. Retaining VIN enables recall lookups, deduplication, and buyer safety features that benefit users. This posture is consistent with standard used-car marketplaces.

### Images — retain with note

**Decision:** Images are retained and displayed for private-seller listings.

**Rationale:** Images from BLVD listing pages are publicly accessible. However, full-resolution images of vehicles could reveal home addresses, driveways, or other location identifiers if not reviewed. This is flagged for future consideration but is not suppressed pre-beta.

**Required action:** If BLVD scraping is approved by counsel for beta, evaluate whether to re-host images or link-through only, to reduce long-term retention of photos taken at private residences.

### City/state location — retain

**Decision:** City and state are retained and displayed.

**Rationale:** City/state is publicly advertised on the BLVD listing card. This is the standard level of location granularity for used vehicle listings.

### ZIP — review before display (deferred)

**Decision:** ZIP code extracted from the seller sidebar during detail extraction is currently stored. Whether to expose it in public API responses for private-seller listings is **deferred** pending counsel review.

**Rationale:** The ZIP from the seller sidebar may be more precise than the city/state from the listing card and could narrow a private seller's home address to a small postal area. This is a lower-priority item than phone numbers but should be evaluated before displaying it publicly for private-seller listings.

---

## Deletion and Staleness Behavior (implemented — #817)

### When a listing disappears from source

When the BLVD scraper no longer finds a listing on subsequent scrapes, the scraper engine marks it `status = 'possibly_gone'` and eventually `status = 'gone'`. Gone listings are excluded from active search results.

### Retention period and disposition

**Decision:** A gone private-seller listing is **anonymized** (not hard-deleted) **30 days** after `goneAt` (`RETENTION_DAYS` in `apps/api/src/services/private-seller-retention.ts`).

**Rationale for anonymize-in-place over hard delete:** the row's non-sensitive fields (make/model/year/price/mileage history, VIN, city/state) remain useful for aggregate market-trend and vehicle-recall lookups after the listing itself is gone, and other rows (`ListingPriceHistory`, `ListingMileageHistory`, `VehicleIdentityDecision`) foreign-key to the listing row. Hard-deleting the row would either cascade-delete that history or require it first, for no privacy benefit beyond what field-level anonymization already achieves.

**Fields cleared:** `dealerPhone`, `dealerName`, `description`, `zip`, `images`, `cardImages` (`RETENTION_CLEARED_FIELDS`). `sourceUrl`/`buyerUrl`, VIN, city/state, and vehicle-fact fields (make/model/year/price/mileage) are retained per the "VIN — retain" and "City/state location — retain" decisions above.

### One deletion contract across every store

`anonymizePrivateSellerListing` (`apps/api/src/services/private-seller-retention.ts`) is the single place both paths below call — it is the deletion contract:

1. **PostgreSQL** — clears the fields above on the `listings` row and sets `retentionAppliedAt` (the idempotency marker: once set, repeat calls are a no-op).
2. **Image references** — deletes the listing's `ListingImage` rows (and their `ListingImageSemanticAnalysis` children). No image bytes are ever stored server-side (`images`/`cardImages` hold source URLs only), so this is reference cleanup, not a media purge.
3. **Raw-page evidence** — deletes `RawPage` rows matching the listing's `sourceUrl`/`buyerUrl` (the full scraped HTML, which can carry the seller's phone/ZIP/description verbatim from the source page).
4. **Meilisearch** — calls `syncListings([listingId], ...)`, the same single-owner incremental indexer `search-indexer-poll` uses. A gone listing is already excluded from the index (`status !== 'active'`), so this is normally a no-op removal; it is still called explicitly so the contract is self-documenting rather than relying on the listing's `gone` status alone. Best-effort: a failure here is non-fatal (the listing was never published to begin with) and self-heals on the next `search-indexer-poll` tick.
5. **Cached responses** — no per-listing response cache exists. The only cache consumer (`apps/api/src/services/listing-facets.ts`) caches aggregate facet counts with a 60-second TTL and holds no listing-level PII, so no explicit invalidation is needed.

Steps 1–3 run inside one PostgreSQL transaction (fail-closed: a failure partway through leaves `retentionAppliedAt` unset and the row unchanged, so the next attempt redoes the whole thing rather than leaving a half-anonymized row).

### Automated sweep and backfill

`apps/api/src/jobs/private-seller-retention.ts` runs daily (`00:15` local time) and anonymizes every `sellerType: 'private', status: 'gone', goneAt <= now - 30d, retentionAppliedAt: null` row, bounded to 20 batches of 100 per run (mirrors `search-indexer-poll`'s draining pattern) — up to 2,000 listings per day. Because eligibility is re-queried fresh every batch — not scoped to "gone since this job started existing" — the same job also drains the pre-existing backlog of already-gone private-seller rows over its first several runs after deploy; no separate backfill script is needed. Private-seller listings are a small fraction of one source's inventory, so 2,000/day comfortably exceeds the expected backlog; if a future backlog ever needs more throughput, `MAX_BATCHES_PER_RUN`/`BATCH_SIZE` in that file are the levers to raise. One listing's anonymization failing does not abort the batch: the failure is logged and recorded in the audit trail, the row stays a candidate (its `retentionAppliedAt` was never set), and it is retried on the next tick.

### When a private seller requests deletion

Operators have an authenticated deletion-request workflow at `POST /admin/private-seller-retention/listings/:id/delete` (guarded by the same `Authorization: Bearer {INTERNAL_API_SECRET}` boundary as every other `/admin` route), with an ops UI at `/ops/privacy-requests`. It calls the same `anonymizePrivateSellerListing` contract immediately, bypassing the `status`/`goneAt` gate — a seller can ask for removal regardless of whether the listing has gone `gone` yet — but still only applies to `sellerType: 'private'` listings. `GET /admin/private-seller-retention/listings/:id/audit` returns the full history.

Requests received at `privacy@wivwav.com` are handled by an operator submitting the listing ID through `/ops/privacy-requests`.

### Audit trail

Every attempt — automated sweep or operator request, success or failure — is recorded as an append-only `ConfigEntry` row (`ops.private-seller-deletion.<listingId>`, via `appendPrivateSellerDeletionAuditEntry` in `packages/db/src/lib/operator-intent.ts`), the same pattern used for source enable/disable audit history. A failed attempt records `errorMessage` so it can be investigated; because `retentionAppliedAt` was never set on failure, the automated sweep retries it automatically once the underlying cause is fixed.

---

## Counsel-Review Deferral

The following items require explicit product or legal approval before public beta:

| Item | Risk | Required decision |
| --- | --- | --- |
| BLVD scraping posture | Resolved | Product decision (2026-08-19): not a launch blocker; WivWav links back to source listings. |
| Private-seller description text indexing | Medium | Product/counsel to choose: suppress, limit, or retain. |
| ZIP code from detail extraction | Low–Medium | Product/counsel to choose: suppress or retain in public API. |
| Image retention for private-seller listings | Low | Product/counsel to confirm link-through vs. re-hosting approach. |
| Retention/deletion policy for gone private-seller rows | Resolved | Implemented 2026-08-20 (#817): 30-day anonymize-in-place, see "Deletion and Staleness Behavior" above. |

These deferrals are documented. No public display of private-seller listings should occur until the BLVD source posture is resolved (item 1 above).

---

## Implemented Mitigations (issue #336)

1. **Phone suppression** — `dealerPhone` is nulled in the API detail response and Meilisearch document for any listing where `sellerType = 'private'`. This prevents personal phone numbers from appearing in the public API or search index.
2. **Privacy page updated** — The privacy policy now discloses that listing data may include private-seller listings from BLVD FSBO pages, describes what fields are retained, and provides a deletion contact path.
3. **This policy document** — Provides a complete data inventory, field-level decisions, and deferred items for counsel/product review.

## Implemented Mitigations (issue #817)

4. **Retention lifecycle** — `apps/api/src/jobs/private-seller-retention.ts` anonymizes gone private-seller listings 30 days after `goneAt`, automatically and idempotently, including the pre-existing backlog at deploy time.
5. **Operator deletion-request workflow** — `/ops/privacy-requests` (backed by `POST /admin/private-seller-retention/listings/:id/delete`) lets an authenticated operator anonymize a specific listing immediately, for seller requests received at `privacy@wivwav.com`.
6. **Audit trail** — every automated and operator-initiated attempt, success or failure, is recorded and queryable via `GET /admin/private-seller-retention/listings/:id/audit`.
7. **Privacy page updated** — now states the 30-day automatic retention window in addition to the manual contact path.
