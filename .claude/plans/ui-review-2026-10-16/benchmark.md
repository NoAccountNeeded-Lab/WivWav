# WivWav benchmark: vehicle marketplaces and WAV sellers

Method: WebSearch and WebFetch on public pages, about 20 calls. Limits: Cars.com, Autotrader, Edmunds, Bring a Trailer, Cars & Bids and Carvana pages were not fetched directly (403 or search-summary only), so their entries lean on search summaries and are marked "(secondary)". Nothing here is a quote over 15 words. No visor.vin, no watchlist or saved-search features recommended.

## 1. Per-site notes

### CarGurus (https://www.cargurus.com/about/how-cargurus-works)
- Result card: price plus a five-step deal rating (Great, Good, Fair, High Price, Overpriced) derived from estimated market value for similar vehicles. Rating is price-only, not condition. CarGurus states this itself.
- Detail page: price history and days on market shown to support negotiation; "price includes fees" badge for upfront dealer fees; dealer rating and screened reviews.
- Price presentation: rating label always paired with the comparison basis, so the number is explained.
- Trust: states plainly it is not the seller and does not inspect or guarantee vehicles.
- Distinctive: market-context framing (is this price fair, is the car stale) rather than only photos.

### Carvana (secondary: https://www.iseecars.com/articles/how-does-carvana-work)
- Gallery: 360-degree spin plus photos of each imperfection (dents, dings) listed on the page.
- Detail: free history report link, condition disclosure, 150-point inspection, open safety recall info.
- Trust: seven-day return window with stated restrictions (mileage cap, notice deadline).
- Mobile: single-column, one big image, key facts stacked.
- Distinctive: honest flaw disclosure as a trust device; the policy is stated with its limits.

### Bring a Trailer and Cars & Bids (secondary: https://www.roadrunnerautotransport.com/news/2718/bring-a-trailer-guide-how-to-buy-and-sell-cars-on-bring-a-trailer, https://carphotochecklist.com/cars-and-bids-photo-guide/)
- Gallery: large, landscape-only photos (Cars & Bids asks for 4:3 or 3:2), typically 40 to 70 per listing, grouped by exterior walkaround, exterior detail, interior summary, interior detail, plus documents and keys.
- Detail structure: editorial write-up, then structured sections (highlights, equipment, known flaws, service history), then comments.
- Trust: a public comment thread works as crowd inspection; sellers answer questions and add photos.
- Distinctive: a published shot list makes photo quality a requirement, not luck. The "editorial" feel comes from consistency and from copy written for the vehicle, not templated.

### Cars.com, Autotrader, Edmunds (secondary: https://www.kbb.com/car-advice/autotrader-listings-vs-car-gurus-listings, https://www.cargurus.com/research/articles/best-used-car-websites)
- Card: photo, price with a price badge (Autotrader uses Good or Great Price against a Kelley Blue Book range), mileage, dealer, distance. Photo count shown on card.
- Detail: price breakdown, history report, dealer reviews (Cars.com strongest), finance calculator.
- Edmunds: editorial strength; expert reviews and a ramp-choice guide for wheelchair vans (https://www.edmunds.com/car-buying/how-to-choose-a-ramp-for-your-wheelchair-van.html).
- Distinctive: price badge always on the card; Autotrader filters for video walkaround and home delivery.

### MobilityWorks (https://www.mobilityworks.com/vehicles/side-entry/, https://www.mobilityworks.com/vehicles/van-dimension-guide/)
- Explains side entry in one idea: the floor is lowered so the passenger stays seated in the chair.
- Dimension guide: one card per conversion with make, model, conversion brand and four key specs (door opening height, ramp width, ramp type, ramp operation). Filters on those same four. Links to full dimensions and inventory.
- Trust: partner conversion brands named, 90+ locations, warranty and disclosure pages, testimonials.
- Distinctive: conversion-first, not vehicle-first. Door height 52.5 to 71 inches and ramp width about 28 to 36 inches are the comparison axes.

### BraunAbility (https://www.braunability.com/us/en/blog/mobility-solutions/side-entry-vs-rear-entry.html, https://www.braunability.com/us/en/mobility-products/wheelchair-accessible-vehicles/side-entry.html)
- Side-by-side explainer: side entry allows front passenger or driver position and flexible seating; rear entry gives more interior space for larger chairs but no front seat access and costs less.
- Frames the choice as questions: chair fit, who drives, is an attendant present, priorities.
- Ramp types: in-floor (side entry only, clear cabin) versus fold-out (lower angle, blocks the doorway when stowed); power versus manual.
- Per-model tables: usable door opening width and height. Advice to test your own chair in person.
- Distinctive: decision framed by person, not by spec.

### Vantage Mobility (https://www.vantagemobility.com/blog/which-type-of-wheelchair-van-is-best-for-you/)
- Caregiver framing: with a dedicated caregiver driving, the ramp need not be automatic and front seats need not be removable, which widens options.
- Manual ramps need the caregiver to unfold, place, fold and secure, which can be hard for an older caregiver.
- Headroom: standard versus extra-tall; measure chair length, width and height seated first.
- Dealer pages (Superior) show: usable door opening height and width, inside centre height, ramp angle, ramp length, ramp load capacity (https://superiorvan.com/products/chrysler-side-entry/vmi-pacifica-northstar-access360/).

### Inventory marketplace: The Mobility Resource (via search summary; page blocked) (https://www.themobilityresource.com/wheelchair-vans/)
- Filters: entry location (side or rear), ramp type (in-floor, fold-out), ramp operation (power, manual), conversion brand (AMS, BraunAbility, Driverge, Rollx, VMI), new or pre-owned, state.
- Filter vocabulary is WAV-native, which is the main thing to match. Also seen: EZmobility Direct, Mobility Express, Superior Van & Mobility listings show conversion brand, ramp location, ramp operation.

## 2. Research findings (cite)
- Baymard: show enough attributes on the list card (price, title, thumbnail plus category-specific specs) or users click every item; half of sites fail this. https://baymard.com/blog/product-listing-information
- Baymard: three or more thumbnails per list item; mediocre list and filter implementations see 67 to 90 percent abandonment in their study. https://baymard.com/research/ecommerce-product-lists
- Baymard: do not hide gallery thumbnails silently. Show all, use arrows, a "+N" last thumbnail, or a partly cut-off last thumbnail. https://baymard.com/blog/truncating-product-gallery-thumbnails
- Baymard: video belongs next to the images with a play icon, not elsewhere. https://baymard.com/blog/embedding-product-page-videos
- NN/g: filters must be appropriate to the product type, predictable, free of jargon (explain terms in context), prioritised by importance. https://www.nngroup.com/articles/filter-categories-values/
- NN/g: list thumbnails must help the decision; list photos should reflect the user's filters. https://www.nngroup.com/articles/mobile-list-thumbnail/ and https://www.nngroup.com/articles/product-photos-listing-pages/
- NN/g: swipe within the card image with small dots is an accepted mobile pattern for extra photos. https://www.nngroup.com/articles/ecommerce-homepages-listing-pages/
- Not found: no Baymard or NN/g study specific to vehicle listings. Treat the above as general e-commerce evidence.

## 3. Twelve patterns WivWav should adopt
Data column uses the context file fill rates; "gap" means we lack data and must add it.

1. Results open with vehicle cards, filters on top as chips. Why: Baymard says list items drive evaluation; the dashboard hides them. Data: all listings.
2. Card carries WAV facts first: entry (side or rear), ramp type, conversion brand, then price and mileage. Why: MobilityWorks and Mobility Resource compare on these; Baymard category-specific attributes. Data: conversion manufacturer 57 percent; entry and ramp mostly unknown, so show "Not stated by seller" quietly (gap, see sections 4 and 5).
3. Card shows 3 or more photos by swipe, with a photo count. Why: Baymard thumbnail finding. Data: average 3.3 images; show count so thin listings are honest.
4. Gallery: large landscape hero, all thumbnails or "+N", arrows, counts. Why: Baymard truncation finding; currently 38 images behind 7 dots. Data: images exist.
5. Price with explained context: "Priced below, near or above similar vans" with the comparison basis stated, plus price history and days listed. Why: CarGurus. Data: price-history route and market route exist; price 82 percent; handle no-price (18 percent) as "Ask dealer for price".
6. Always state fees and estimate assumptions next to any monthly payment. Why: CarGurus fees badge. Data: gap (assumptions undocumented).
7. Plain "what this means" lines for WAV terms, in context (tooltip or inline), not a glossary page. Why: NN/g jargon guidance; BraunAbility explanation style. Data: static copy.
8. Fit measurements block: door opening height and width, ramp width, ramp length, inside height, ramp load capacity. Why: Vantage and BraunAbility pages lead with these. Data: floorLoweringInches 0 percent, wheelchairCapacity 2 percent, so a gap; fall back to conversion-model reference tables.
9. Filter vocabulary matches WAV sellers: entry location, ramp type, ramp operation, conversion brand, new or pre-owned conversion, seating or wheelchair positions. Why: NN/g appropriate filters; Mobility Resource. Data: schema fields exist, fill is low.
10. Honest completeness: show what the seller did not say, and a data-quality note, instead of blank chips. Why: Carvana and CarGurus trust through disclosure. Data: fill rates known.
11. Seller trust panel: dealer, location, phone, source, time since last seen, plus a neutral "we list, we do not sell or inspect" line. Why: CarGurus stance. Data: dealer name 84 percent, phone 11 percent, lat/lng 73 percent.
12. Normalised vehicle titles: consistent make casing, clean trims, "Year Make Model Trim" only. Why: Baymard title finding; BaT consistency. Data: casing bugs measured (Gmc, PACIFICA, Chevy).

## 4. Five patterns to avoid
1. A facet dashboard (charts, bar lists) as the first screen of results; shoppers want vehicles.
2. Tabs that hide core facts (WAV, Vehicle, Market, Safety); Baymard shows hidden content gets missed. Use one scrolling page with anchors.
3. Silent gallery truncation (tiny dots with 38 images).
4. Opaque scores or badges with no basis, or ones implying condition. CarGurus itself labels its rating as price-only.
5. Jargon-only WAV labels ("Infloor", "XT", "Access360") without an inline explanation, and warnings like "may no longer be available" that are not tied to a clear, true age threshold.

## 5. Five signature moments for WivWav
1. "Will my chair fit?" Enter chair width, length and seated height once; each listing shows a plain fit line using door opening, ramp width and inside height (when known), or a clear "measurement not listed". Data gap; start from conversion-model reference tables (Vantage and BraunAbility publish them).
2. Entry and ramp explained on the card and detail page in one sentence each, written for caregivers: who drives, where the chair sits, what the ramp blocks when stowed, who must operate it. Source material: BraunAbility and Vantage framing above, paraphrased and checked.
3. "Which entry type suits you" guide as a short two-question helper (do you drive or ride up front; is a caregiver deploying the ramp) that sets the entry and ramp filters. Not a saved profile.
4. Compare two vans side by side on the same fit and price facts, in the session only (not a saved list, respecting the watchlist pause).
5. Photo standard: ask sellers and show badges for "interior and ramp photos present" (ramp deployed, interior from the rear, door opening with tape measure like Cars & Bids shot-list discipline). Show it as an honest completeness meter on the card. Data gap now: avg 3.3 images; this is also a seller-feedback loop.

## 6. Caveats
- Several site details are from secondary summaries; verify on live pages before committing to specifics.
- Vehicle dimension examples (door 54 to 57 inches, ramp 29 to 30 inches) come from dealer listings and vary by model year; use only as reference ranges, never as listing facts.

## visor.vin (study reference)
Study only: not a look to copy, and no watchlist or saved-search feature is recommended (paused by the owner). Sources: WebFetch of visor.vin home page and App Store listing (both fetched, 200), plus WebSearch summaries. Unverified: live results page and detail page layout (inferred from the home page examples and descriptions), gallery behaviour, mobile web layout (the native apps are the mobile product), filter widgets' exact look.

### What it does (3-6 bullets each)
**Result card anatomy**
- Year, make, model, trim, condition, mileage, price, location, days on the market.
- Stock status label: on lot, in transit, in production.
- Rarity callouts for unusual colour or option combinations (for example "1 of 1").
- Photo gallery on the card (extent unverified).
- No deal badge by design; the owner of the site criticizes deal ratings.

**Filter UX**
- Filters adapt to the current selection so a combination cannot return zero results.
- Search box accepts model, VIN, dealer, plate or a listing URL.
- Map search that respects natural boundaries rather than only a zip radius.
- Price against mileage chart that doubles as a filter (via search summary, unverified).
- Option-level filters by installed equipment (paid tier).

**Detail page structure** (home page examples and summaries; layout unverified)
- Photos, then the listing history with every price change and days on the market.
- Colour and option rarity counts against national inventory ("of the N for sale nationwide").
- Installed options each with an average price comparison.

**Gallery**: full photo sets; no further detail verified.

**Price and deal presentation**
- Shows raw facts instead of a verdict: price history, 30-day price change in dollars, price against original sticker price.
- Market pages state units, change and month-over-month percentages.
- Sorting and comparing is left to the shopper.

**VIN-centric features**
- Search by VIN, plate or URL; VIN appears in listing addresses.
- Filters by factory-installed option read from the VIN.
- Per-vehicle history is keyed on the VIN across dealers.

**Trust signals**
- No ads, no selling leads, no contact details needed upfront.
- Named small team, public changelog and roadmap, a direct support address.
- Shopper testimonials about savings (marketing, not proof).

**Mobile pattern**: native iOS and Android apps with the same search; web mobile layout unverified. Store reviews: 4.3 (65 ratings) on iOS, 3.8 (30) on Google Play, with reports of filters resetting on crash.

**Distinctive**: data the other sites hide (price history, rarity, option detail) used as the product, plus a plain "no bias" stance.

**Why it feels polished**: every card number is a measured fact with a unit; status words are short and consistent; filters never dead-end; one search box handles many input types. Third parties also call the design a bit dated, so polish here comes from data clarity, not visuals.

### Six patterns WivWav could adopt (in WivWav's own visual language)
1. Facts-not-verdict price block: price, change since first seen, days listed, with the basis in words. Data: price 82% filled; price history API exists (`/v1/listings/:id/price-history`); 18% unpriced shows "Call for price".
2. Dead-end-proof filters: show the live result count on each option and disable or dim options that give zero. Data: `/v1/listings/facets` already returns counts.
3. One search box that accepts a VIN, make and model, or dealer name, routing a VIN to `/vin/[vin]`. Data: VIN 95% filled; the `vin` route exists.
4. Stock freshness line on the card ("Listed 42 days", "Price dropped $1,200"). Data: first-seen and last-seen timestamps, price history. Replaces the unclear "may no longer be available" warning.
5. Rarity or "how many like this" line on the detail page ("1 of 12 white Pacifica side-entry conversions listed"). Data: conversion manufacturer 57%; counts from facets; skip where the field is unknown.
6. Price against mileage scatter as the only chart on the results page, collapsible, and clicking a point opens the vehicle. Replaces the facet dashboard. Data: price 82% and mileage 97% give about 80% of listings plottable; clip mileage outliers (fixes the "696kk+" axis).

### Three things to avoid
1. A paywall tier for core filters; WivWav's trust story needs everything free, and expansion is paused.
2. Rarity or market jargon with no WAV meaning (colour rarity matters little to a wheelchair shopper); keep rarity to conversion and entry type.
3. Treating the research-page footer sprawl as a model; the sparse WivWav data (3 sources, 96% unknown ramp type) cannot back dozens of market pages, and thin pages erode trust.
