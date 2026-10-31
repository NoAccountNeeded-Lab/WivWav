# Data audit: vehicle detail page and results card

Scope: local DB copy (7,060 active + eligible listings), API `GET /v1/listings/:id`, SSR HTML of `/en/vehicle/<id>` for 10 listings (files `/private/tmp/review/api_<id>.json`, `html_<id>.html`).

Limitation: a permission classifier denied one batched read of `VehicleTab.tsx`, `vehicleTabUtils.ts`, `WavTab.tsx` and `vehicleSpecs.ts`. I did not retry. Their content is inferred from rendered HTML only. Facts about those four files are marked "(inferred)".

## 1. Field matrix

DB column to API detail response to web render. Fill % is of the 7,060 published set.

### `listings`

| Column | Fill | API detail | Vehicle page | Results card | Problem |
|---|---|---|---|---|---|
| id, make, model, year, trim | 100/100/100/100/83% | yes | title, h1 | title | Casing and noise (section 3) |
| vin | 95% | yes | Specs list, Safety tab | no | OK |
| condition | 100% | yes | pill and header | text | Wrong for private sellers (section 3) |
| sellerType | 100% | yes | DealerCard | "Private seller" text | OK |
| priceCents | 82% | yes | header, price block | image overlay | `$1` shown as price; "Call for price" for null |
| mileage | 97% | yes | chip, gauge | number only, unit is `sr-only` | 475,000 mi shows "238% of expected life used"; new cars with 2,700 mi |
| color | 21% | yes | chip with a "◆" glyph, no swatch | no | Raw OEM strings |
| fuelType | 13% | yes | chip, plus "Fuel type" row | no | Duplicates the engine chip |
| engine | 4% | yes | chip, plus "Engine" row | no | Duplicate list, "See Options", trailing "/" |
| transmission | 10% | yes | chip, plus row | no | Inconsistent casing, "Unknown" literal (23 rows) |
| conversionType | known 35% | yes (`wav`) | WAV tab | badge if known | Unknown renders nothing on the card; fine |
| conversionManufacturer | 57% | yes | brand block | not on card (but in list payload as `conversionBrand`) | Variant names (section 3) |
| floorLoweringInches | 0% | yes | never shows | no | Dead field. Hide or show "not provided" |
| rampType | known 4% | yes | WAV tab, card badge | badge | Mostly unknown |
| conversionStatus | 100% unknown | yes | not shown | no | Dead field, 100% unknown |
| wavFeatures | 2% | yes | WAV tab, card badges | badges | Mostly empty |
| wheelchairCapacity | 2% | yes | "WC capacity 1 chair" (abbreviation) | no | Abbreviation in UI copy |
| conversionTypeResolution, rampTypeResolution | 100% | `fieldResolution` | not shown | no | Provenance not surfaced |
| zip | 20% | yes | not shown | no | Cross listing shows a bare zip |
| city, state | 81/80% | yes | chip, header | text | 1,314 have no city |
| lat, lng | 73% | yes | NMEDA dealer lookup only | no | No map, no distance |
| vehicleId | 9% | `vehicleId` | cross listings, VIN history | no | Only 636 listings linked |
| vehicleModelId, matchConfidence | 2% | `vehicleModelId`, `provenance.vehicleModelMatchConfidence` | Safety, Vehicle, Market data | no | Only 160 rows, so Safety and Vehicle tabs are nearly empty |
| dealerName | 84% | yes | DealerCard | no | OK |
| dealerPhone | 11% | yes | DealerCard | no | OK |
| dealerWebsite | 11% | yes | DealerCard | no | OK |
| dealerProfileId | 0% (local) | yes | DealerReputation | no | Never shown; `dealer_profiles` has 0 rows locally |
| images | avg 3.3 | yes | gallery | `images[0]` | 5,718 (81%) have exactly 1 image, 24 have none |
| cardImages | n/a | yes | not used | not used (card uses `images[0]`) | Thumbnail data unused |
| description | 6% (402 rows) | truncated to about 300 chars | "From the listing" | no | Ellipsis cut mid-sentence; no HTML found |
| isDuplicate, canonicalId | 0 rows | yes | no | no | Unused, dedupe not needed |
| status, saleStatus, goneAt, soldAt | n/a | yes | not shown | no | Sold status never shown to buyer |
| retentionAppliedAt, processingLockedAt, lastRunId, missingFromCompleteCount | internal | in public JSON | not shown | no | Internal fields leak into the public API (Low) |
| lastSeenInCompleteCrawlAt | 100% | yes | **not used** | no | The best freshness signal is ignored |
| qualityCheckedAt | 100% | in `provenance` | not used | no | Ignored |
| listedAt | 100% | yes | "Found X ago", "First saw" | NewBadge | See section 2 |
| sourceListedAt | 0% | yes | "On source X days" | no | Never populated, branch is dead code |
| sourceUpdatedAt | 3% (193) | yes | "Source updated Mar 4, 2025" | no | Shows year-old dates on fresh listings |
| scrapedAt | 100% | `provenance.scrapedAt` | "Last verified" (fallback) | no | Used as the verified time for 98% of rows |
| detailScrapedAt | 2% (140 rows set, 6,920 null) | `provenance` | "Last verified" (preferred) | no | Almost always null |
| sourceUrl, buyerUrl, externalId, stockNumber | high | yes | CTA, "Seller stock number" | no | OK |
| publicationStatus, qualityIssueCodes | 100% | not exposed | no | no | OK (internal) |

### Related tables

| Table | Rows (local) | API | Web | Gap |
|---|---|---|---|---|
| listing_price_history | 6,139 rows, 0 listings with a change | `/price-history` | sparkline, chart, drop badge, only if the price changed | Hidden for all 6,139 locally, nothing to show yet |
| listing_mileage_history | 7,301 | only via `/vin/:vin/history` | VIN timeline in Market tab | No per-listing view |
| listing_conversion_history | 7,634 | `/conversion-history` | WavConversionHistory in WAV tab | Shown only on a change |
| listing_field_claim | 3,563 | no | no | Provenance of conversionType and rampType unused |
| listing_observation | 11,061 | no | no | Before and after audit, unused |
| vehicle | 636 linked | `vehicleId` | cross listings, VIN history | Only 9% linked |
| vehicle_models | 514 | `/safety`, `/vehicles/...` | Safety, Vehicle, Market tabs | Linked to 160 listings only |
| recalls | 3,371 across 8 models | `/safety` | Safety tab | Only 8 models have recalls |
| complaints | 62,290 | `/safety` | Safety tab | Not verified whether shown |
| safety_ratings | 306 | `/safety` | Safety tab | Same |
| dealer_profiles, dealer_reviews | 0, 0 locally | `/dealer` | DealerReputation | Empty locally; check production before judging |
| nmea_dealers | 0 locally | `/nmea-dealers` | "Certified dealers nearby" | Local table empty, UI says "none found" |
| vehicle_model_research | 0 | `/research` | "Vehicle" tab (inferred) | Empty |
| vehicle_stats | 8 | `/stats` | gauge lifespans | Mostly falls back to hard coded table |

## 2. Spot checks (8+ listings, DB vs API vs rendered)

All API values matched DB rows. Mismatches are in the rendering logic.

| Listing | Case | Finding |
|---|---|---|
| `cmv8wx444002301mo8bwtfupv` Kia Telluride 2025, new, dealer, 39 images | many images | "Last verified 42 hours ago" plus "may no longer be available" although `lastSeenInCompleteCrawlAt` is fresh. Engine renders "Regular Gasoline V-6 3.8 L/231, Regular Unleaded V-6 3.8 L/231" (the same value twice). Fuel "Gasoline Fuel". "Also available at Freedom Motors, Battle Creek, $84,737" is the same dealer and the same price as the main seller. Est. $1,326/mo. |
| `cmv8wx7ji009301mo1yutw13g` Traverse (orchestrator example) | 38 images | Engine "Gas I4 2.5L/" and "Gasoline Fuel" chips. Cross listing is the same dealer, same price (blvd.com mirror). |
| `cmvafajes0rqn01mozz5dm964` 2008 Town & Country, private, no price | null price | "Call for price". Safety tab says "No open recalls" and "Safety data not yet available" at once. |
| `cmvagn93o0wke01moe8gjs64n` 1995 Ford E 250 | pre-2000 | Model "E", trim "250": title reads "1995 Ford E 250". "58% below median" computed from only 4 listings. Safety tab green "No open recalls" with no data. Mileage 109,000 against 200,000 lifespan (generic fallback). |
| `cmvaf8fs30lfg01moeb55mfuy` 2011 Town & Country, conversion unknown | unknown conversion | The WAV tab shows no conversion block at all (no "not provided" state). Shows "Certified Dealers Nearby: No certified dealers found nearby" for Raleigh, NC (the table is empty locally, so the claim is false). |
| `cmvaee6um06ph01mom39mcta0` Traverse 2022 | capacity 4 | "WC capacity 4 chairs": abbreviation. Colour "Black with flames" is free text from a description. Description has a non-ASCII hyphen and is cut at the 300 char limit. |
| `cmvaee1f406dx01mozbsljzam` 2009 Dodge Caravan, 475,000 mi | extreme mileage | Make, model and trim have trailing spaces in the DB ("Dodge ", "Caravan ", "WE "), so the page title has double spaces. "238% of expected life used" (unclamped). Source updated Oct 13, 2025 on a listing first seen 2026-10-15. |
| `cmv3oi5aa000401nz5rnsbowh` 2007 Grand Caravan, 0 images | no images | "No photo available". Last verified 5 days ago, flagged stale (correct). No location: header and chip omit it silently. Similar listings include entries with "Call for price" (no price). |
| `cmvafamuz0s0e01moet34l5qg` 2023 Pacifica, private, "new", 2,700 mi | condition wrong | A private seller "New" with 2,700 miles. "Also available at For Sale By Owner, White Plains NY 10604": the same seller as the main listing (no city on main, city on cross). |
| `cmvagnimd0x8v01mo8m4949rh` 1993 VW Eurovan, $1 | price $1 | Header "$1", "Est. $0/mo", market data hidden. `priceCents=100` is a placeholder price. |
| `cmvaee1yi06es01mo2h64wyc6` 2012 Ford E-350 | long trim | Trim "SUPER DUTY PASSENGER XL EXTENDED VAN 3D" goes into the h1 and the page title. "48% above median" with only a few comps. |

### Logic mismatches (code level)

1. "may no longer be available". `verificationUtils.ts:4` `STALE_THRESHOLD_HOURS = 12` and `verificationUtils.ts:~22` returns `detailScrapedAt ?? scrapedAt`. `detailScrapedAt` is null for 6,920 of 7,060 rows, so `scrapedAt` is used. 6,452 listings (91%) have a `scrapedAt` older than 12 hours. Only 1,649 have a `lastSeenInCompleteCrawlAt` older than 12 hours. So the stale warning appears on roughly 9 in 10 listings, and it is wrong for most of them. Fix: use `max(lastSeenInCompleteCrawlAt, detailScrapedAt, scrapedAt)` and use a 48 or 72 hour threshold, keyed to crawl cadence.
2. "Found X ago". `OverviewTab.tsx` uses `sourceListedAt ?? listedAt`. `sourceListedAt` is 0% filled, so every listing reads "Found today/N days ago". That is WivWav's first-seen date, not the listing's age. For a buyer, "Found 1 day ago" on a car listed for 8 months is misleading. `sourceUpdatedAt` (3%) is shown as "Source updated", which is an old date for some.
3. Date formatting. `utils.ts` `formatDate` has no `timeZone`. "First saw Oct 15, 2026" against `listedAt 2026-10-16T03:14Z`: server time zone vs UTC, and a hydration mismatch risk on the client.
4. Est. monthly payment. `utils.ts` `estimateMonthly`: 80% financed, 6.5% APR, 60 months, hard coded and not stated anywhere on the page. It applies to 1993 cars ($1 gives "Est. $0/mo") and to cash-only private sales. Effort S to either state assumptions or remove.
5. Price vs market axis shows `$9,919.8`, `$73,952.5`, `$14,924.75`, `$62,997.5`. `utils.ts:formatPrice` calls `toLocaleString` with default fraction digits (up to 3) on interpolated percentile values. Fix: `Math.round(cents / 100)` or `maximumFractionDigits: 0`.
6. Gauge. `MileageGauge.tsx` computes `miles / lifespan` with no clamp (238%). `getExpectedLifespan` (`utils.ts`) falls back to 200,000 for any make not in a 9 entry hard coded table (e.g. VW, Mercedes). The same hard coded number is displayed as "Dodge avg lifespan". The gauge is shown above the specs and contains an unsourced claim.
7. "Also available at". `listing-repository.ts:455` `findCrossListingsByVehicleId` filters only on `vehicleId`, status and source. No dedupe by dealer name, price, or the same `sourceUrl`/mirror. Result: the same dealer and the same price appear under the heading "Also available at". Fix: exclude rows with the same `dealerName` and `priceCents` as the current listing, or collapse mirrors (blvd.com) into the main seller.
8. Pacifica cross listing. The same private seller appears twice (once without a city). Two source rows for the same car are not merged by VIN.

## 3. Data quality visible to users

| # | Problem | Evidence | Root cause (file:line) | Class | Fix | Sev | Effort |
|---|---|---|---|---|---|---|---|
| 1 | Mileage label "696kk+ mi" | `MileageHistogram.tsx:38-39` `fmtMiles` returns `"696k"`; `messages/en.json:206` `highPlus` is `"{value}k+ mi"` (also `high`, `range` in en and es); `MileageHistogram.tsx:181` appends another `k` for aria | Display | UI | Make `fmtMiles` return the bare number (`696`), or drop the `k` in all three strings and line 181 | High | S |
| 2 | Histogram axis dominated by outliers | `max(mileage) = 695,004`; 11 used cars over 300,000 mi, 1 "new" at 308,108 | `DEFAULT_MAX=200000` ignored; no cap on facet range | Display + ingestion | Cap the axis at p99 or 200k and treat higher as "200k+"; quarantine implausible mileage in ingestion (`implausible_value` only flags 9) | Med | S |
| 3 | Make casing and whitespace | `Gmc` 66 vs `GMC` 33; `Chevy` 3 vs `Chevrolet` 744; `Mercedes` 24 vs `Mercedes-benz` 14; `Vw` 1; trailing space variants ("Chrysler " 12, "Dodge " 5, "Honda " 5, "Chevrolet " 3, "Toyota " 2) | No make canonicaliser in the scraper normalise step; Title Case applied naively (makes "Gmc") | Ingestion | Add an alias table (GMC, Chevrolet, Mercedes-Benz, Volkswagen, Ram) and `trim()` all text fields at ingest; backfill migration | High | M |
| 4 | Garbage makes | `Mobility` 19, `Vpg` 6, `Blue` 1: the converter name was parsed as the make | Source title parsing | Ingestion | Reject or re-resolve from VIN WMI or vehicle_models; quarantine | High | M |
| 5 | ALL CAPS models and junk models | 23 rows incl. "PACIFICA", "GRAND CARAVAN", and a 100+ char model "RAM 2500 CONVERSION WINDOW VAN WITH BRAUNABILITY ... POWER CHAIR!" | Raw source string kept | Ingestion | Case-normalise against `vehicle_models`; cap model length and quarantine over 40 chars | Med | M |
| 6 | Trim noise | 1,170 null; "LE 8 Passenger 4dr Mini Van", "SUPER DUTY PASSENGER XL EXTENDED VAN 3D", "XLE/XLE Premium/Ltd/Ltd Premium", "1500 136 WB" | Trim holds body style text | Ingestion + UI | Strip passenger counts, "4dr", "Mini Van", body text; UI: truncate the trim in the h1 and show it as a secondary line | Med | M |
| 7 | Condition wrong for private sellers | 100 private "new" listings (e.g. Pacifica 2,700 mi); 268 "new" listings with 100+ miles; `new_with_high_mileage` flagged 178 but still eligible | Defaulting condition at ingest; quality rule flags but does not demote | Ingestion | Infer condition from mileage (over 500 mi means used); make the rule block publication or set condition used | High | S |
| 8 | Price placeholder | min `priceCents` = 100 ($1); 53 listings under $5,000 | No lower bound in the quality gate | Ingestion | Treat price under $2,000 as null ("Call for price") | Med | S |
| 9 | Colour names without swatch mapping | 25 top colours: "Bright White Clearcoat", "Diamond Black Crystal Pearlcoat", "Lakeshore Blue Metallic", "Ice Cap", "Burgundy", "Maroon", "WHITE" / "White" | Facets use canonicaliser in `@wivwav/search`, but detail page shows the raw `color`; no hex lookup | UI + ingestion | Show the canonical colour with a swatch and the raw name as a tooltip; fix the hex map for Burgundy, Maroon, Champagne, Charcoal | Med | M |
| 10 | Fuel and engine duplicates | `fuelType`: Gasoline 808 / Gas 69 / "Gasoline Fuel" 43 / Hybrid Fuel; engine "Gas I4 2.5L/" (25 rows), "See Options" (10), "Regular Gasoline V-6 3.8 L/231, Regular Unleaded V-6 3.8 L/231" | Raw source string; chip row `OverviewTab.tsx` renders `engine`, `transmission`, `fuelType` as separate chips with no dedupe | Ingestion + UI | Normalise fuel to Gasoline/Diesel/Hybrid/Electric/Flex; strip trailing "/" and dedupe comma lists; hide engine "See Options"; do not render a fuel chip when the engine chip already says it | Med | S |
| 11 | Transmission casing and literals | "automatic" 25, "Unknown" 23, "Automatic" 267, "8-Speed Automatic w/OD" | Raw source string | Ingestion | Lowercase map to Automatic/Manual/CVT; drop "Unknown" | Low | S |
| 12 | "Unknown" conversion and ramp | conversion unknown 65%, ramp unknown 96%; the WAV tab shows no conversion block and the card shows no badge | UI shows nothing | Genuinely missing | Show an explicit "Conversion type not provided by seller: ask the dealer" row with an icon | Med | S |
| 13 | Missing geocode | lat null for 1,923 (27%), city null 1,314, zip null 5,642 | Private-seller classifieds lack location; no zip-to-geo backfill | Ingestion | Backfill lat/lng from zip or city, state; hide "Certified dealers nearby" when lat/lng is missing | Med | M |
| 14 | "No certified dealers found nearby" shown when the NMEDA table is empty or the lookup failed | `nmea_dealers` 0 rows locally; `getNearbyDealers` swallows errors and returns `[]` (`detail-page.tsx` getNearbyDealers catch) | Display | UI | Distinguish an error or empty table from a real zero; hide the block on error | Med | S |
| 15 | Conversion manufacturer variants | BraunAbility 1,977 vs Braun 56; Rollx 80 vs "Rollx Vans" 50; ATS 91 vs ATC 52; VMI 546 vs Vantage Mobility 286 | No alias map | Ingestion | Canonical brand list | Med | S |
| 16 | Developer copy shown to users | Rendered text: "No reliability or lifespan score is populated. WivWav does not calculate reliability scores or scrape commercial score providers; add values only with a public, linkable source." appears in the Vehicle section (Grand Caravan, Pacifica) | Message in the Vehicle tab component (inferred, file not read) | Display | Remove; show nothing when no score exists | High | S |
| 17 | Misleading safety status | Safety tab: green "No open recalls" badge plus "Safety data not yet available for this vehicle" plus "Safety data freshness unknown" on listings with no vehicle model | `safetyTabUtils.ts:81` falls through to `{ level: 'good', label: noOpenRecalls }`; `SafetyTab.tsx:64` shows the badge when `safety !== null` (the API returns an object even with no data); only 160 of 7,060 listings have a `vehicleModelId` | Display + data | Render the badge only when a vehicle model has data; otherwise "No safety data yet" with a link to the VIN check | High | S |
| 18 | Description boilerplate | 402 rows, avg 752 chars; truncated by the API to about 300 chars and ends with an ellipsis mid-word; no HTML tags or entities found; one example is the seller's personal notes | `snippetDescription` in `apps/api/src/routes/listings.ts:35` | Display | Truncate at a sentence boundary | Low | S |
| 19 | Image count and ordering | 81% of listings have exactly 1 image; 24 have 0; the card uses `images[0]` while `cardImages` is available; the gallery shows 1 image plus dots | Source gives card thumbnails only; detail job did not run (`detailScrapedAt` null for 98%) | Ingestion | Run detail scrape for single-image listings; the card should show a "1 photo" hint; for 0 images show a clear placeholder (exists) | High | M |
| 20 | Pre-2000 model naming | "1995 Ford E 250" (model "E", trim "250") | Model and trim split on a space | Ingestion | Join as "E-250" via `vehicle_models` | Low | S |
| 21 | Price per month on cheap/old vehicles | "$1 / Est. $0/mo" | `estimateMonthly` | UI | Hide below $5,000 or when the price is a placeholder; state the assumptions | Med | S |
| 22 | Gauge "238% of expected life used" | `MileageGauge.tsx` | UI | `Math.min(100, ...)`; label "Over typical lifespan" | Low | S |
| 23 | Odd "◆" glyph for colour chip | `OverviewTab.tsx` (chip block) | UI | Replace with a real colour swatch (see #9) | Low | S |
| 24 | Header and chips omit missing location silently | listings with null city | UI | Show "Location not provided" for dealers; for private sellers show state or zip when known | Low | S |
| 25 | Internal fields in the public API | `lastRunId`, `retentionAppliedAt`, `processingLockedAt`, `missingFromCompleteCount` in `GET /v1/listings/:id` | `apps/api/src/routes/listings.ts` serializer | Display (API) | Drop from the public shape | Low | S |

## 4. Fix split

Fix in UI: #1, #2 (axis), #12, #14, #16, #17, #18, #21, #22, #23, #24, #25, plus logic items 1 (stale), 2 ("Found" wording), 3 (time zone), 4, 5, 6, 7 in section 2.

Fix in ingestion or normalisation: #3, #4, #5, #6, #7, #8, #9 (colour map), #10, #11, #13, #15, #19, #20.

Data genuinely unavailable (show a clear not-provided state or hide): conversion type (65%), ramp type (96%), `floorLoweringInches` (0%), `wheelchairCapacity` (98%), `wavFeatures` (98%), engine (96%), fuel (87%), transmission (90%), colour (79%), dealer phone (89%), description (94%), `sourceListedAt` (100%). Do not render empty chips. For the core WAV facts, show a labelled "Not provided by seller: ask the dealer" row so the absence is explicit.

## 5. Data we have and do not use well

1. `lastSeenInCompleteCrawlAt` for an accurate "Confirmed available X ago". Replaces the false stale warning.
2. `listing_price_history`: 6,139 rows, but zero price changes locally. When changes exist the sparkline and drop badge already render, so they will appear after a few crawls. A "Price dropped $X" badge on the results card would be new.
3. Days on market from `listedAt`: the card has only a NewBadge. Add "Listed N days" on card and page.
4. `listing_mileage_history` (7,301 rows): no direct display, only the VIN history timeline.
5. `listing_conversion_history` (7,634 rows): shown only in the WAV tab when changed.
6. `listing_field_claim` (3,563 rows): evidence kind (structured_source vs photo vs text) and confidence. Could drive a "Source reported" vs "Detected from photos" label on conversion type and ramp type. The API already returns `fieldResolution`, which the page ignores.
7. `listing_observation` (11,061 rows, before and after JSON): could power "What changed" (price, mileage, features) with exact dates.
8. `complaints` (62,290 rows) and `safety_ratings` (306): only usable for the 160 listings with a model link. Improving the `vehicleModelId` match rate (2%) unlocks all safety data. This is the highest value linkage fix.
9. `dealer_profiles` / `dealer_reviews` (0 rows locally): the UI exists; verify production fill. Dealer rating on the results card would help trust.
10. `vehicleModelMatchConfidence`, `qualityCheckedAt`: could back a "WivWav checked" mark.
11. `cardImages`: unused; the card could use them as the thumbnail for fast loads.
12. `conversionBrand` is in the list payload, not shown on the card. A brand logo or name (BraunAbility, VMI) on the card is the main WAV differentiator after price.
13. `dealerName` on the card: the list payload has it, the card omits it.
14. `saleStatus`, `soldAt`, `goneAt`: not shown. A "Sold" or "Recently removed" state on the detail page would replace the vague stale warning.
15. Lat/lng (73%): no map or "N miles away" on the card or page. A distance from the user's zip would be the strongest decision signal for a local purchase.

## Ranked top-15 fix list

| Rank | Fix | Sev | Effort |
|---|---|---|---|
| 1 | Replace freshness logic: use `lastSeenInCompleteCrawlAt` and a 48 to 72 hour threshold, so the false "may no longer be available" warning (91% of listings) goes away (`verificationUtils.ts`) | High | S |
| 2 | Fix "696kk+ mi" double k (`MileageHistogram.tsx:39` and `en.json:204-207`, aria at line 181) and cap the mileage axis | High | S |
| 3 | Safety tab: no green "No open recalls" badge without vehicle-model data (`safetyTabUtils.ts:81`, `SafetyTab.tsx:64`) | High | S |
| 4 | Remove the developer copy "WivWav does not calculate reliability scores..." from the Vehicle section | High | S |
| 5 | Make canonicalisation at ingest: trim whitespace, make alias map (GMC, Chevy, Mercedes-Benz, VW), model casing, manufacturer aliases; backfill | High | M |
| 6 | Quarantine garbage makes ("Mobility", "Vpg", "Blue") and over-long models | High | M |
| 7 | Condition inference: private "new" and "new" with 100+ miles become used (178 flagged and still eligible) | High | S |
| 8 | Raise vehicle-model match rate (160 of 7,060) so Safety, Vehicle and Market tabs have data | High | L |
| 9 | Run detail scrape for single-image listings (81% have 1 photo) | High | M |
| 10 | Dedupe "Also available at" by dealer, price and mirror source (`listing-repository.ts:455`) | Med | S |
| 11 | Round prices in the market histogram (`$9,919.8`) in `utils.ts` `formatPrice` | Med | S |
| 12 | State or remove "Est. $/mo" assumptions; hide below $5,000 or for placeholder prices; reject price under $2,000 at ingest | Med | S |
| 13 | Explicit "not provided, ask the dealer" row for conversion type, ramp, capacity; stop silently omitting them | Med | S |
| 14 | Normalise fuel, engine, transmission; hide duplicate engine and fuel chips; strip trailing "/" and "See Options" | Med | S |
| 15 | "Found X ago" wording: label as "First seen by WivWav", add days on market; fix `formatDate` time zone | Med | S |
