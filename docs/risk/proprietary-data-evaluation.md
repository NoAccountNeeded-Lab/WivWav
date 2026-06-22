# Proprietary Vehicle Data Source Evaluation

Reviewed: 2026-06-22
Status: **Research complete — recommendation column populated; no scrapers implemented**
Issue: #217

This document inventories vehicle and vehicle-history data sources that cannot be cleanly obtained from NHTSA, vPIC, or EPA/FuelEconomy.gov public APIs. For each source it documents the access path, caching/display terms, and a recommended action.

---

## What the Public APIs Already Cover

Before listing gaps, these sources are confirmed clean for WivWav use:

| Source | Data | Notes |
| --- | --- | --- |
| NHTSA vPIC API (`vpic.nhtsa.dot.gov/api/`) | VIN decode, make/model/year/trim, manufacturer records, WMI | Government data, no license required. Batch decode up to 50 VINs. |
| NHTSA Recalls API (`api.nhtsa.gov/recalls/`) | Recall campaigns by VIN or make/model/year | Government data, no license required. Already used by WivWav. |
| NHTSA Complaints API (`api.nhtsa.gov/complaints/`) | Consumer complaints by make/model/year | Government data, no license required. |
| NHTSA Safety Ratings API (`api.nhtsa.gov/SafetyRatings/`) | 5-Star crash test ratings by vehicle ID | Government data, no license required. Already used by WivWav. |
| FuelEconomy.gov web services (`fueleconomy.gov/feg/ws/`) | Fuel economy (city/highway/combined MPG), CO2 score, annual fuel cost, engine specs, drive type | DOE/EPA public web service. ~100 fields per model. U.S. government open data; no licensing fee. Standard government attribution terms apply. Already used by WivWav. |

These sources are unrestricted for caching and display with source attribution.

---

## Source-by-Source Evaluation Matrix

### 1. J.D. Power Reliability and Quality Ratings

| Field | Detail |
| --- | --- |
| **Source** | J.D. Power (jdpower.com) |
| **Data wanted** | Vehicle Dependability Study (VDS) scores, Initial Quality Study (IQS) scores, model-year reliability rankings |
| **Public API / dataset?** | No public API. J.D. Power offers business data products and licensing through a separate enterprise sales channel. Chrome Data — formerly a vehicle specs/MSRP data company — is now a J.D. Power subsidiary (`chromedata.com` redirects to `jdpower.com/business/automotive`). Enterprise contact required. |
| **Terms allow caching/display?** | Unknown without a license agreement. J.D. Power scores are commercial products; displaying them without a license almost certainly requires a contract. Reproducing a "J.D. Power score" without their mark-use guidelines also carries trademark risk. |
| **Robots / rate limits** | jdpower.com returned HTTP 403 during this review; scraping is technically blocked. |
| **Permission / contact route** | `jdpower.com/business` enterprise sales inquiry. |
| **Legal review needed?** | Yes — before any use. |
| **Recommendation** | **Request permission / API access.** Do not scrape. Contact J.D. Power enterprise sales to understand licensing cost and display requirements. Defer display until a license is in place. |

---

### 2. Consumer Reports Reliability Ratings

| Field | Detail |
| --- | --- |
| **Source** | Consumer Reports (consumerreports.org) |
| **Data wanted** | Predicted reliability scores, owner satisfaction ratings, recommended/not-recommended designation |
| **Public API / dataset?** | No free public API. Consumer Reports operates a `data.consumerreports.org` data licensing and brand licensing service for businesses, but it returned HTTP 403 during this review. Access requires direct contact. |
| **Terms allow caching/display?** | No — Consumer Reports data is subscriber-only content. The organization explicitly protects scores from free redistribution to preserve their subscription model. |
| **Robots / rate limits** | `consumerreports.org` blocks automated access. |
| **Permission / contact route** | Contact via `data.consumerreports.org` or their partnerships page. Licensing fees likely apply. |
| **Legal review needed?** | Yes. |
| **Recommendation** | **Request permission / API access.** Do not scrape. Contact Consumer Reports data licensing. Expect a paid license and display restrictions (e.g., required attribution, linking back to CR). Low probability of a free tier for a startup. |

---

### 3. IIHS Crash Test Ratings

| Field | Detail |
| --- | --- |
| **Source** | Insurance Institute for Highway Safety (iihs.org) |
| **Data wanted** | Good/Acceptable/Marginal/Poor ratings for front, side, roof, headlight, and crash-avoidance tests; Top Safety Pick / Top Safety Pick+ status |
| **Public API / dataset?** | No public API found. IIHS does not advertise a developer program. Ratings are available on their public website pages but without a stated open-data license. |
| **Terms allow caching/display?** | Unknown. The iihs.org ratings pages do not carry an open-content license. Copyright applies. Individual factual ratings (e.g., "Good") may be facts not protectable by copyright, but reproducing structured IIHS rating tables requires clarification. |
| **Robots / rate limits** | Not evaluated (site blocked during review). |
| **Permission / contact route** | Contact IIHS media/licensing team. Some press uses of ratings appear permitted for news coverage but commercial aggregation is different. |
| **Legal review needed?** | Yes — to determine whether individual rating values are unprotectable facts or whether the structured dataset carries a copyright. |
| **Recommendation** | **Legal review required** before storing or displaying. Link out to the relevant IIHS vehicle rating page as an interim approach (no copyright issue with a URL). |

---

### 4. Original MSRP (Where Not Available from Government Sources)

| Field | Detail |
| --- | --- |
| **Source** | Multiple: J.D. Power Chrome Data, Edmunds, KBB, Black Book |
| **Data wanted** | Manufacturer's Suggested Retail Price (base and option-level) for model years at time of sale; window sticker MSRP for used vehicle context |
| **Public API / dataset?** | No free government source for MSRP. FuelEconomy.gov includes a `basePrice` field in vehicle records (confirmed present in the API schema). This covers many model years and is the best free option. For older or incomplete records, commercial providers are needed. J.D. Power Chrome Data, Edmunds, and Black Book all license MSRP data through paid APIs. |
| **Terms allow caching/display?** | FuelEconomy.gov `basePrice`: likely permissible (DOE public data, same as other FuelEconomy fields). Commercial MSRP data: requires per-provider license agreement. |
| **Robots / rate limits** | Commercial provider sites block scraping (KBB and Edmunds both returned HTTP 403 during this review). |
| **Permission / contact route** | FuelEconomy.gov: already accessible. Edmunds: contact their developer/data team. KBB (Cox Automotive): enterprise inquiry via `chromedata.com` / J.D. Power. Black Book: `blackbookus.com` data solutions. |
| **Legal review needed?** | Yes for commercial MSRP providers. No for FuelEconomy.gov `basePrice`. |
| **Recommendation** | **Use FuelEconomy.gov `basePrice` first** (already in scope for issue #219). For gaps, **request permission** from one commercial provider. Do not scrape Edmunds or KBB. |

---

### 5. Repair Frequency, Maintenance Cost, and Ownership-Cost Data

| Field | Detail |
| --- | --- |
| **Source** | RepairPal, YourMechanic, Consumer Reports (ownership costs), AAA annual driving cost studies |
| **Data wanted** | Average annual repair cost by model, reliability grade, common repair frequency, ownership cost per mile |
| **Public API / dataset?** | RepairPal previously operated a public API but it appears discontinued (repairpal.com/info/api returned HTTP 404 during this review). CarMD had a Vehicle Health API but that URL also returned 404. AAA publishes annual aggregate driving cost studies as PDFs — free to reference but not machine-readable datasets. No active public API found for model-specific repair costs. |
| **Terms allow caching/display?** | Unknown. AAA reports are public but not licensed as data. RepairPal and Consumer Reports data are commercial products. |
| **Robots / rate limits** | Not fetched during this review; assume blocking until confirmed. RepairPal is known to protect its data commercially. |
| **Permission / contact route** | RepairPal: contact via repairpal.com (API program may be available for enterprise partners despite the public page being gone). AAA: use published reports as cited sources with links, not extracted datasets. |
| **Legal review needed?** | Yes before storing model-specific repair cost figures from any commercial source. |
| **Recommendation** | **Link out only** as an interim approach — show a "See repair costs at RepairPal" link with the model-specific RepairPal URL. **Do not store or display figures** scraped from RepairPal or Consumer Reports. Contact RepairPal to determine if a data partnership is available. |

---

### 6. Technical Service Bulletins (TSBs) Outside NHTSA

| Field | Detail |
| --- | --- |
| **Source** | NHTSA (public, already used), Mitchell 1, ALLDATA, IDENTIFIX |
| **Data wanted** | Full TSB text, affected VIN ranges, repair procedures for TSBs not appearing in NHTSA manufacturer communications |
| **Public API / dataset?** | NHTSA publishes TSB records (manufacturer communications) in its public datasets. Full TSB text and repair procedures are held by commercial providers (Mitchell 1, ALLDATA) under manufacturer license agreements — these are not freely available and redistribution rights are strictly restricted. |
| **Terms allow caching/display?** | No — full TSB content is licensed from manufacturers by commercial data providers under strict redistribution terms. Displaying TSB repair text without a license from the original provider (or the manufacturer) is a copyright violation. |
| **Robots / rate limits** | Commercial providers (Mitchell 1, ALLDATA) require account access — not public sites. |
| **Permission / contact route** | Not a practical path for a startup without a shop management contract. |
| **Legal review needed?** | Yes. |
| **Recommendation** | **Do not use.** Stick to NHTSA TSB/manufacturer communication records (already free). Link out to the NHTSA manufacturer communications page for a given vehicle. Do not attempt to source full TSB text from commercial providers. |

---

### 7. Vehicle History Data (Title, Odometer, Accident, Service Records)

| Field | Detail |
| --- | --- |
| **Source** | Carfax, AutoCheck (Experian), NMVTIS |
| **Data wanted** | Title history, accident history, odometer rollback flags, flood/lemon title flags, service records, number of owners |
| **Public API / dataset?** | NMVTIS (National Motor Vehicle Title Information System) is a government program run by the DOJ/Bureau of Justice Assistance. It collects data from all 50 states on title, brand, and odometer records. Businesses can access NMVTIS data through approved NMVTIS providers (not directly from the government database). NMVTIS-approved providers must be certified; the data is not free but is regulated. Carfax and AutoCheck are private companies that aggregate NMVTIS data plus additional private records; they do not expose public APIs for consumer-facing display. |
| **Terms allow caching/display?** | Carfax and AutoCheck data: no — both companies have strict licensing terms and are known to pursue legal action against unauthorized use or redistribution. NMVTIS data via an approved provider: may be permitted under NMVTIS program rules, but display and caching terms depend on the provider contract. |
| **Robots / rate limits** | carfax.com and autocheck.com block automated access. |
| **Permission / contact route** | Carfax: contact `carfax.com` dealer/business sales. AutoCheck (Experian): contact Experian Automotive. NMVTIS provider path: review the AAMVA list of approved NMVTIS data providers and apply for access. |
| **Legal review needed?** | Yes — required before any use of Carfax or AutoCheck data. NMVTIS provider path is lower risk if using an approved provider under their certified program, but still needs counsel review. |
| **Recommendation** | **Legal review required.** The most viable path is integrating with a NMVTIS-approved provider (lower risk than Carfax/AutoCheck direct). Do not scrape Carfax or AutoCheck. Consider linking out to Carfax or AutoCheck report pages by VIN as a zero-risk interim approach. |

---

### 8. Dealer and Inventory Metadata from Sites with Restrictive Terms

| Field | Detail |
| --- | --- |
| **Source** | BLVD.com, MobilityWorks, AutoTrader, CarGurus, Cars.com |
| **Data wanted** | WAV listing inventory, dealer name/phone/location, pricing, condition, photos, VIN |
| **Public API / dataset?** | None of these sites offer free public APIs. AutoTrader and Cars.com have partner/OEM programs but not open APIs. BLVD.com has no publicly visible ToS or scraping policy (footer has no legal link; robots.txt only disallows `/admin` and `/my-blvd`). MobilityWorks blocks crawlers aggressively (HTTP 429 Too Many Requests returned during robots.txt fetch). |
| **Terms allow caching/display?** | Unknown for BLVD (no ToS found). MobilityWorks: no ToS link found in public footer during prior review. AutoTrader/CarGurus/Cars.com: all prohibit scraping in published terms. |
| **Robots / rate limits** | BLVD: no crawl-delay, only `/admin` and `/my-blvd` disallowed — listing paths not blocked by robots.txt. MobilityWorks: rate-limited (HTTP 429 on robots.txt fetch). |
| **Permission / contact route** | BLVD.com: contact page at blvd.com/contact. MobilityWorks: dealer inquiry or corporate contact. AutoTrader/Cars.com: see paid data provider alternatives in `prelaunch-scraping-risk.md`. |
| **Legal review needed?** | Yes — required before public beta for BLVD and MobilityWorks; see `docs/risk/prelaunch-scraping-risk.md` for the full scraping-risk audit. Do not add AutoTrader, CarGurus, or Cars.com as scraper sources without counsel. |
| **Recommendation** | **Legal review required** for BLVD and MobilityWorks before public beta. **Do not use** AutoTrader, CarGurus, or Cars.com as scraper sources. Consider paid licensed inventory providers (Auto.dev or MarketCheck — already evaluated in `prelaunch-scraping-risk.md`). |

---

### 9. Conversion-Manufacturer Product Specs and Pricing

| Field | Detail |
| --- | --- |
| **Source** | BraunAbility, VMI (Vantage Mobility International), Freedom Motors, Rollx Vans, AMS Vans |
| **Data wanted** | Conversion product names (e.g., "BraunAbility Northstar"), ramp/lift type, door entry height, floor lowering depth, MSRP or base price, compatible base vehicles |
| **Public API / dataset?** | No API or structured dataset. BraunAbility and VMI both had connection failures during this review — their product pages are consumer-facing HTML only. Specs are available on individual product landing pages in unstructured form. Pricing is generally not published; dealers quote on request. |
| **Terms allow caching/display?** | No explicit license found on product pages. Marketing copy and product names are the manufacturer's IP. Factual specs (ramp length, floor lowering depth, compatible base vehicles) may be unprotectable facts. Pricing is not published publicly for most products. |
| **Robots / rate limits** | BraunAbility: not evaluated (connection refused). VMI: not evaluated (connection refused). |
| **Permission / contact route** | BraunAbility: contact business development at brauncorporation.com. VMI: contact via mobility dealer network. NMEDA (National Mobility Equipment Dealers Association) may be a useful intermediary — they have an industry directory but do not publish a public conversion specs database. |
| **Legal review needed?** | No for factual specs (dimensions, model name, compatible base vehicle) if sourced from publicly available product pages and attributed. Yes before reproducing marketing copy or images. |
| **Recommendation** | **Request permission** for a structured data feed from BraunAbility and VMI. As interim, manually curate key product specs (model name, ramp/lift type, floor lowering range) with source links — factual dimensions are not protectable. Do not reproduce product descriptions, marketing copy, or images without a license. |

---

## Summary: Recommended Action per Source

| Source | Recommendation | Contact needed? | Legal review? |
| --- | --- | --- | --- |
| J.D. Power (reliability scores) | Request permission / API access | Yes (enterprise sales) | Yes |
| Consumer Reports (reliability ratings) | Request permission / API access | Yes (data licensing) | Yes |
| IIHS crash test ratings | Legal review required; link out only in interim | Yes (media/licensing) | Yes |
| MSRP — FuelEconomy.gov `basePrice` | **Use now** (already public API) | No | No |
| MSRP — commercial providers | Request permission (one provider) | Yes | Yes |
| Repair cost / maintenance cost | Link out only (interim); contact RepairPal | Yes (RepairPal) | Yes before storing data |
| Full TSB text | **Do not use** | No | — |
| Vehicle history (Carfax/AutoCheck) | Legal review; consider NMVTIS provider | Yes | Yes |
| Vehicle history (link-out only) | **Use now** — link to Carfax/AutoCheck by VIN | No | No |
| BLVD.com listing inventory | Legal review before public beta | Yes | Yes (see prelaunch-scraping-risk.md) |
| MobilityWorks listing inventory | Legal review before public beta | Yes | Yes (see prelaunch-scraping-risk.md) |
| AutoTrader / CarGurus / Cars.com | **Do not use** as scraper source | — | Yes if reconsidering |
| Conversion specs (factual, attributed) | **Use now** — manual curation with source links | No | No |
| Conversion marketing copy / images | Do not reproduce without license | Yes (per manufacturer) | Yes |
| NMEDA dealer directory | Review terms; likely low risk for links | Optional | No |

---

## Sources That Should Be Contacted for Permission or API Access

In priority order for WivWav product value:

1. **RepairPal** — repair cost data is directly useful to WAV buyers evaluating used vehicle reliability. Contact their business partnership team. A "link out" fallback requires no contact.
2. **BraunAbility and VMI** — conversion product specs are uniquely relevant to WivWav's WAV focus. A structured product feed from these manufacturers would differentiate the platform. Reach out to their dealer/business development teams.
3. **J.D. Power** — reliability data adds value but is expensive to license. Lower priority than conversion specs.
4. **Consumer Reports** — similar to J.D. Power; valuable but likely high cost and restrictive display terms for a startup.
5. **NMVTIS-approved provider** (for vehicle history) — preferable to Carfax/AutoCheck direct due to government-regulated access path. Research approved provider list via AAMVA before making contact.

---

## Sources That Require Lawyer Review Before Any Use

1. **Carfax / AutoCheck** — known for aggressive enforcement of data terms. Any caching, scraping, or display requires counsel sign-off.
2. **BLVD.com and MobilityWorks** — already flagged in `prelaunch-scraping-risk.md`. This evaluation confirms: no public ToS found for BLVD; MobilityWorks actively rate-limits. Both require counsel review before public beta.
3. **J.D. Power** — commercial product with trademark implications; displaying scores requires a license agreement. See section 1.
4. **Consumer Reports** — subscriber-only data; redistribution requires a paid license. See section 2.
5. **IIHS** — uncertain whether individual rating values are facts or protectable expression. Requires counsel clarification before storing.
6. **Full TSB text from commercial providers** — manufacturer-licensed content under redistribution restrictions. Do not pursue.
7. **Commercial MSRP providers** — review contract terms for display, caching, and derived data rights.

---

## Product Principle Reminder

Per WivWav's core principle: **do not create a WivWav reliability score or purchase-quality ranking.** Even if licensing is obtained from J.D. Power or Consumer Reports, WivWav's role is to present source-attributed facts with links, not to produce a composite or derivative rating. See `docs/data/vehicle-stats-sources.md` for field-level policy on `reliabilityScore`, `jdPowerScore`, and related fields.

---

## Evidence URLs

- vPIC API: https://vpic.nhtsa.dot.gov/api/
- NHTSA Safety Ratings API: https://api.nhtsa.gov/SafetyRatings/
- FuelEconomy.gov web services: https://www.fueleconomy.gov/feg/ws/
- J.D. Power business / Chrome Data: https://www.jdpower.com/business/automotive (chromedata.com redirects here)
- Consumer Reports data intelligence: https://data.consumerreports.org
- IIHS ratings about page: https://www.iihs.org/ratings/about-our-tests (site blocked automated access during this review; robots.txt not successfully fetched)
- BLVD.com robots.txt: https://www.blvd.com/robots.txt (only `/admin` and `/my-blvd` disallowed)
- NMVTIS (DOJ): https://vehiclehistory.bja.ojp.gov
- AAMVA NMVTIS page: https://www.aamva.org/nmvtis/
- Auto.dev pricing: https://www.auto.dev/pricing (paid inventory provider alternative)
- MarketCheck pricing: https://www.marketcheck.com/apis/pricing/ (paid inventory provider alternative)
