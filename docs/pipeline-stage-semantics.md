# Listing pipeline stage semantics

Status: decided (issue #1159); open decisions settled in section 6. Reviewed once by Codex (2026-10-22); findings are folded in.

Source: pipeline audit of 2026-10-16 (counts come from a local snapshot of 7,518 listings, not production), checked against code after #1156 and #1157. This document defines terms; it does not change code. The readiness predicate (#1103) and the Pipeline page must use these definitions so every dashboard and the gate agree.

## 1. Terms

- **Database eligibility**: `listings.publicationStatus = 'eligible'`. Means the validator found no blocking issue. Today it is decided at first card scrape, before detail, VIN decode, geocode or dedupe.
- **Search visibility**: a listing is returned by the public API and search only when `status = 'active'` AND `publicationStatus = 'eligible'` AND its source is not disabled. Operator-hidden listings (`manuallyHiddenAt`, #1157) are never published by listing-resolve. Eligibility alone is not visibility: `gone` and `possibly_gone` rows can be `eligible` and are hidden.
- **Ready**: proposed term for the gate (#1103). A listing is ready when it is eligible AND every required stage below is in an accepted end state. Visibility is meant to follow "ready" (plus the visibility filters above), not bare "eligible".
- **Proof marker**: the column or row that shows a stage reached an end state. A stage with no marker cannot be required.
- **Stage states**, used the same way in every screen:
  - `done`: the marker shows the stage finished.
  - `waiting`: the stage can run and has not yet.
  - `unsupported`: the stage cannot run for this listing (for example no city to geocode). Counts as an accepted end state only where the table says so.
  - `exempt`: the stage does not apply (for example no VIN means no VIN decode).
  - `unobservable`: no marker exists, so the state cannot be known today.

## 2. Stages

"Required" means a listing is not ready while the stage is open. "Optional" means a gap is a warning shown in ops, never a block. "Trigger" is what starts the stage; stages do not run in a fixed global order.

| # | Stage | Trigger | Proof marker | Required? | Accepted end states |
|---|---|---|---|---|---|
| 1 | Card scraped | cron per source | `scrapedAt`, `listing_observation(stage=list_card)` | Required | done |
| 2 | Detail fetched | hourly cron per source | raw page row for the listing (`raw_pages`) | Required | done |
| 3 | Detail extracted and current | every-5-minute cron per source | `detailScrapedAt` set AND `detailStaleAt` null | Required | done |
| 4 | Validated after latest detail | event: listing-resolve | `qualityCheckedAt >= detailScrapedAt` AND `publicationStatus = 'eligible'` | Required | done (`eligible`). `pending` is waiting. `quarantined` is blocked, not an end state. |
| 5 | VIN decoded, model matched | 6-hour cron | `vehicleModelId` not null. `vehicleModelMatchConfidence` is recorded but not required. | Required when a VIN exists | done; or exempt (no VIN) |
| 6 | Images present | set by scrape, replaced by detail | `images` length at least 1 | Required | done |
| 7 | Conversion type resolved | detail extraction | `conversionType`, `conversionTypeResolution` | Required | done (known value); or `unknown` after stage 3 is done |
| 8 | Ramp type resolved | detail extraction | `rampType`, `rampTypeResolution` | Optional | any value including `unknown` |
| 9 | Geocoded | daily cron | `lat` not null | Optional | done; or unsupported (city or state missing) |
| 10 | Deduplicated | daily cron | none usable: `vehicleId` is set only for VIN groups of 2 or more | Optional | unobservable |
| 11 | Dealer enriched | daily cron | `dealerProfileId` | Optional (dead column) | unobservable: never populated, 0 of 7,060 |
| 12 | Image semantic analysis | manual only, no schedule | `listing_image_semantic_analysis` | Optional | unobservable until scheduled |
| 13 | Indexed in search | every-minute poll | Meilisearch document, no Postgres marker | Not a stage | consequence of readiness, not part of it |
| 14 | Vehicle-level data (NHTSA, research, MSRP) | weekly crons | model-keyed tables | Optional | feeds the vehicle page, not the listing |

Notes:
- Geocode, dedupe and indexing never change `publicationStatus`.
- "Done" is always judged from the marker, never from "the job ran".
- Card-stage validation (the decision made at first scrape) cannot be told apart from later validation: `qualityCheckedAt` is overwritten. Only stage 4 (validated after the latest detail) is a reliable marker. Historical card-only passes are unobservable.
- Stage 2 and 3 are separate so ops can show "page fetched but not yet extracted" (a fetched `raw_pages` row with `processedAt` null).

## 3. How "unknown" is treated

| Case | Treatment | Why |
|---|---|---|
| `conversionType = 'unknown'` after stage 3 is done | Accepted end state; warning only | A listing can genuinely not state it. Before stage 3, `unknown` is open, not final. |
| `rampType = 'unknown'` | Warning only, never blocks | 96% of listings are unknown; blocking would hide nearly everything. |
| No VIN | Exempt from stage 5; shown as "exempt, no VIN" | 5.4% of listings have none. |
| VIN present, not decoded | Open (blocks) | The decode is the only source of model identity. |
| VIN decode tried and failed | Treated as open until a failure marker exists | No marker today; needs a decision (section 6). |
| City or state missing (either one) | Geocode is `unsupported`; warning only | Geocoding needs both. 1,430 listings cannot be geocoded. |
| City and state present, `lat` null | Geocode `waiting`; warning only | Optional stage. |
| Single image only | Warning, not block | 81% have one card image. |

## 4. Staleness

- **Aged detail**: `detailScrapedAt` older than 30 days. The detail crawler re-queues such listings. Aged detail is a warning, not a block. The listing stays ready until the re-crawl is extracted. When extraction writes new detail, validation resets to `pending` (stage 4 reopens), so the listing is briefly hidden until listing-resolve finishes. Ops should show "waiting for re-fetch" (stage 2) separately from "waiting for validation" (stage 4).
- **Detail invalidated by a card change** (shipped in #1156): a card re-scrape that changes an identity, conversion or color field sets `detailStaleAt`. The listing is held `pending` until a fresh detail page clears it. Fresh means the raw page was fetched at or after `detailStaleAt`; applying older HTML keeps the hold. This is a block, unlike aged detail, because the stored detail may now describe a different vehicle. It is the `detailStaleAt IS NULL` half of stage 3.
- **Stale validation**: `qualityCheckedAt` older than `detailScrapedAt`. This is stage 4 open, not a warning.
- **Card age**: no stage depends on card age; recency is judged through listing `status` (`active` to `possibly_gone` to `gone`).
- A card re-scrape that changes none of the fields above keeps a detail-complete listing's decision. It no longer resets it to a card-only decision.

## 5. Eligibility vs visibility

| Condition | Eligible? | Visible in search? |
|---|---|---|
| `active` + `eligible` + source enabled | yes | yes |
| `active` + `pending` | no | no (waiting on listing-resolve) |
| `active` + `quarantined` | no | no |
| `possibly_gone` or `gone` + `eligible` | yes | no |
| `active` + `eligible` + source disabled | yes | no |
| operator-hidden (`manuallyHiddenAt`) | not published by resolve | no |

Today, visible means active, eligible and source enabled. After #1103, visible means those plus ready (every required stage in section 2). Ops screens must show both numbers and name them as defined here.

## 6. Decisions

Delegated by the requester on 2026-10-22 and settled by Claude with a second opinion from Codex. Reopen any of them by comment on #1159.

1. **Required set**: keep section 2 as written. Sources may be exempted (decision 3), and a recorded terminal VIN-decode failure counts as an accepted end state (decision 4).
2. **Card-only listings**: stay visible during the report-only rollout of #1103 (validator-clean only). Enforce readiness only after the detail backfill and a per-source coverage check. Recompute the production impact first: the audit's roughly 120 of 7,060 ready was a local snapshot under a slightly different predicate.
3. **Sources whose detail pages block crawling**: a per-source "card-only is acceptable" setting. It still requires validation, at least one image and the stale-detail safeguards, and never bypasses quarantine or manual hiding.
4. **Failed VIN decode**: an accepted end state after three completed decode attempts, recorded in a failure marker (not yet existing; add it in #1103). Infrastructure errors do not count as attempts. Until the marker exists, VIN decode is a warning, not a block.
5. **Aged detail (over 30 days)**: warning only; the crawler requeues it. Status rules and the #1156 hold cover genuinely wrong data.
6. **Persistence**: keep `publicationStatus` validator-only and compute "ready" separately from current markers. Ops can then show "eligible but not ready". Indexing and public database reads must apply the same ready test, and must remove listings that are already indexed but not ready.
