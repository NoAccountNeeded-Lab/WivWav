# Pre-Launch Scraping Risk Audit

Reviewed: 2026-06-17

This packet is a technical and product risk handoff for counsel. It is not legal advice.

## Recommendation

Public beta should not launch with unsanctioned scraper-derived listing inventory until counsel reviews the source posture below and product chooses a privacy/copyright posture for descriptions and private-seller data.

Lowest-risk launch path:

1. Use paid/licensed inventory data for public listing search, or obtain written permission from each direct source.
2. Keep NHTSA and FuelEconomy.gov vehicle-safety/research enrichments enabled because they are published public APIs/datasets.
3. Defer or disable BLVD.com and MobilityWorks scraping for public beta unless counsel approves limited use.
4. Complete follow-up issues #335 and #336 before any launch that exposes scraped descriptions or private-seller inventory.

## Current Listing and Data Sources

| Source | Current use | Reviewed terms/status | Scraping risk | Recommended launch posture |
| --- | --- | --- | --- | --- |
| BLVD.com | Registered scraper source in `apps/scraper/src/index.ts`; indexes dealer listings and `/wheelchair-vans-for-sale-by-owner` private-seller listings. Detail extraction can store full description text. | Public home page advertises 5,451 active listings and "the world's largest selection" of wheelchair vans. I did not find a visible Terms/Privacy link on the public home page during this review. No written reuse permission is recorded in the repo. | High. Core listing marketplace, private-seller inventory, no recorded license, and AI-assisted selector remapping could be framed as continuing access after layout changes. | Block public beta use unless counsel approves or written permission/license is obtained. If retained for internal testing, reduce crawl frequency and do not expose private-seller listings publicly. |
| MobilityWorks | Registered scraper source in `apps/scraper/src/index.ts`; dealer inventory pages and detail pages. Detail extraction can store description, images, dealer phone, and ZIP. | Public site links a Privacy Policy last updated January 1, 2021. Footer exposes Privacy Policy and External Linking Policy, but I did not find a public Terms of Use page in the linked footer set. No written reuse permission is recorded in the repo. | Medium-high. Dealer-owned inventory source with product descriptions and images. Lower privacy risk than BLVD FSBO, but still no recorded content license. | Block public beta use unless counsel approves or written permission/license is obtained. If retained, show source links only and avoid full copied descriptions. |
| NHTSA datasets and APIs | VIN decode, recalls, complaints, and safety ratings jobs/API routes. | NHTSA publishes official datasets/APIs as part of its Open Government data pages. Ratings, recalls, and complaints pages describe APIs and downloadable data, with daily/annual dataset update cadence depending on dataset. | Low. Official government data source. Still respect API reliability and attribution. | Allow for beta. Retain source attribution and keep data freshness visible where possible. |
| FuelEconomy.gov | Model research enrichment source for EPA fuel economy and related model facts. | FuelEconomy.gov publishes web services documentation for vehicle data access. | Low. Public government web service. | Allow for beta with source attribution. |
| AutoTrader | Mentioned in issue text but no current adapter/registration found in the repo during this review. | Not evaluated as an active source because it is not currently registered. | High if added later, because issue notes prior legal action and commercial listings exposure. | Do not add or re-enable before separate counsel review and written approval/license. |
| CarGurus | Mentioned in issue text but no current adapter/registration found in the repo during this review. | Not evaluated as an active source because it is not currently registered. | High if added later, because it is a commercial listings marketplace. | Do not add or re-enable before separate counsel review and written approval/license. |

Source evidence:

- BLVD.com public home page: https://www.blvd.com/
- MobilityWorks Privacy Policy: https://www.mobilityworks.com/privacy-policy/
- MobilityWorks public home page/footer links: https://www.mobilityworks.com/
- NHTSA Datasets and APIs: https://www.nhtsa.gov/nhtsa-datasets-and-apis
- FuelEconomy.gov web services: https://www.fueleconomy.gov/feg/ws/

## Product Behavior Review

Description handling:

- `detail-extract` writes `detail.description` to the `listing.description` field for supported detail pages.
- BLVD and MobilityWorks detail parsers extract free-text seller/dealer description text.
- The current listing detail overview does not display `listing.description`, but the API returns it and the search service includes it in searchable fields.
- Follow-up issue #335 tracks limiting or removing full third-party description copy and keeping source attribution/source links.

Private-seller data:

- BLVD parsing classifies "For Sale By Owner" cards as `sellerType: private`.
- Private-seller rows can include source URLs, VINs, city/state, images, price, mileage, and dealer/name-equivalent seller text.
- Detail extraction can later add phone/ZIP/description if available on the detail page.
- Follow-up issue #336 tracks private-seller ingest, indexing, display, retention, privacy copy, and deletion behavior.

## Paid Data Alternatives

| Provider | Coverage/pricing notes | Fit for WivWav | Risks/questions |
| --- | --- | --- | --- |
| Auto.dev | Public site offers Vehicle Listings. Pricing page shows Starter at $0/month plus data fees with 1,000 free API calls/month and Vehicle Listings at $0.002/call; Growth is $299/month plus data fees with Vehicle Listings at $0.0015/call; Scale is $599/month plus data fees with Vehicle Listings at $0.001/call. | Strong candidate for beta replacement because pricing is public and includes listing/search primitives. Need confirm WAV-specific filter coverage, photos, source attribution, dealer/private seller coverage, and redistribution/display rights. | Must review contract/API terms for display, caching, derived data, photos, and private-seller data rights. |
| MarketCheck | Public site says it scans over 100,000 dealer websites across the US, Canada, and UK, updates daily, and includes new, used, certified, private seller, and auction listings. Pricing page shows Free at 500 calls/month plus data fee, Basic at $299/month plus data fee, Standard at $749/month plus data fee, Inventory Search API at $0.002/call, and Private Party Inventory Search API at $0.01/call. | Strong candidate for broader inventory coverage and private-seller inventory, but likely needs contract review for redistribution and WAV-specific conversion filtering. | Paid but not automatically low-risk: MarketCheck itself aggregates source inventory. Counsel should review rights chain, attribution, retention, and private-seller handling. |

Provider evidence:

- Auto.dev home/listings: https://www.auto.dev/ and https://www.auto.dev/listings
- Auto.dev pricing: https://www.auto.dev/pricing
- MarketCheck home: https://www.marketcheck.com/
- MarketCheck API pricing: https://www.marketcheck.com/apis/pricing/

## Legal-Review Handoff

Questions for counsel:

1. ToS and contract: Can WivWav scrape and publicly display BLVD.com or MobilityWorks listing facts, images, descriptions, and links without a written agreement?
2. CFAA and anti-circumvention: Does the AI-assisted structure detector/remapper materially increase risk if a source changes markup, blocks selectors, or otherwise signals that automated extraction is unwanted?
3. Copyright: Are copied listing descriptions and images protectable content, and is WivWav's current storage/search indexing use permissible if public display is limited?
4. Derived facts: Which extracted fields can be treated as non-copyrightable facts, and what attribution/source-link requirements should apply?
5. Private-seller personal data: Can WivWav ingest, index, display, and retain FSBO contact/location/VIN data under CCPA/GDPR and similar state privacy laws?
6. Deletion/refresh: What removal SLA is required when a source listing disappears, a private seller requests deletion, or a source sends a takedown request?
7. Provider alternatives: Do Auto.dev or MarketCheck contract terms permit public display, caching, search indexing, photos, pricing analytics, and derived WAV-specific features?
8. Beta posture: Can a limited, invite-only beta use unlicensed scraped data for evaluation, or should beta use only licensed/provider data and government APIs?

## Required Before Public Beta

- Counsel-approved source posture for BLVD.com and MobilityWorks.
- Product decision on disabling scraper sources vs. replacing them with a paid/licensed provider.
- Completion or explicit legal/product deferral of #335.
- Completion or explicit legal/product deferral of #336.
- PR/release notes stating which sources are enabled for beta and which authenticated `/ops/sources` disable action is the rollback switch for each scraper source.
