# Private-Seller Personal Data Policy

Reviewed: 2026-06-18
Status: **Implemented with counsel-review deferral** (see section below)
Follow-up from: #138, #336

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

**Rationale:** Description text may contain personal context but also contains WAV-specific details that are useful for buyers. The text is already publicly visible on BLVD.com. A product decision to suppress it would require changes to the search index settings and API response. This deferral is documented and must be resolved before public beta alongside the BLVD source posture review in `docs/risk/prelaunch-scraping-risk.md`.

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

## Deletion and Staleness Behavior

### When a listing disappears from source

When the BLVD scraper no longer finds a listing on subsequent scrapes, the scraper engine marks it `status = 'possibly_gone'` and eventually `status = 'gone'`. Gone listings are excluded from active search results.

**Gap:** There is no automatic hard deletion of private-seller rows when a listing goes `gone`. The row and all extracted fields (including phone, description, images) remain in the database indefinitely.

**Required action before public beta:** Implement a retention policy for gone private-seller listings. Options:

1. Hard-delete gone private-seller rows after N days (e.g., 30 days after `goneAt`).
2. Null out sensitive fields (`dealerPhone`, `description`, `images`) on transition to `gone`.
3. Require a specific deletion request workflow.

### When a private seller requests deletion

There is no self-service deletion mechanism. Requests received at `privacy@wivwav.com` should be handled manually by deleting or anonymizing the relevant `listings` row. The privacy page has been updated to document this contact path.

---

## Counsel-Review Deferral

The following items require explicit product or legal approval before public beta:

| Item | Risk | Required decision |
| --- | --- | --- |
| BLVD scraping posture | High | Counsel to approve or block BLVD as a source. See `prelaunch-scraping-risk.md`. |
| Private-seller description text indexing | Medium | Product/counsel to choose: suppress, limit, or retain. |
| ZIP code from detail extraction | Low–Medium | Product/counsel to choose: suppress or retain in public API. |
| Image retention for private-seller listings | Low | Product/counsel to confirm link-through vs. re-hosting approach. |
| Hard-deletion policy for gone private-seller rows | Medium | Engineering to implement retention schedule once policy is set. |

These deferrals are documented. No public display of private-seller listings should occur until the BLVD source posture is resolved (item 1 above).

---

## Implemented Mitigations (issue #336)

1. **Phone suppression** — `dealerPhone` is nulled in the API detail response and Meilisearch document for any listing where `sellerType = 'private'`. This prevents personal phone numbers from appearing in the public API or search index.
2. **Privacy page updated** — The privacy policy now discloses that listing data may include private-seller listings from BLVD FSBO pages, describes what fields are retained, and provides a deletion contact path.
3. **This policy document** — Provides a complete data inventory, field-level decisions, and deferred items for counsel/product review.
