# WivWav public site: design, UX and accessibility critique

Scope: whole public site. Read-only. Evidence: the 9 PNGs in /private/tmp/review/ plus code in apps/web/src. Paths below are relative to apps/web/src. Contrast ratios were computed from the CSS tokens in app/globals.css (WCAG relative luminance). I did not run a browser, so hover, focus and tab content are judged from code.

Severity: H/M/L. Effort: S (under 1 day), M (1-3 days), L (a week or more).

## 0. Verdict

The site is a data dashboard that happens to contain cars. It never says "wheelchair accessible vehicles for people and caregivers", and it never shows a car above the fold on home or results. Hierarchy is flat: every facet group has the same pale violet card, the same small uppercase label and the same bar. Home and results spend the first 900px on filter plumbing. The vehicle page hides the three questions a shopper asks, namely price, "can this carry my chair" and "how do I contact them". These sit behind 5 tabs at 11px text, and the gallery is a single dot-carousel with a large empty area under it.

BRAND.md says "calm, practical, not a generic marketplace". That is the right instinct. The current execution is also not distinctive. The strongest asset is the hero-quality conversion imagery (blue Traverse with ramp deployed, in 03-results). It is currently shown with a tiny "illustration only" watermark and a dark gradient that hides it.

Four recommendations conflict with, or need an explicit exception to, BRAND.md and owner preferences:
- Owner preference: no left-rail filters, and filters on top that collapse into chips. Results currently has top filters but never collapses them.
- BRAND.md says "restrained, no marketing sections". I propose one compact value-proposition strip, not a marketing page.
- BRAND.md says "cards only for repeated listings". The facet groups are cards (FilterGroup.module.css:3-12). I recommend removing that fill.
- BRAND.md describes seasonal themes, but globals.css has only violet. Doc and code have drifted (see F-48).

## 1. Findings

### (a) Home / discover (01-home-1440, 09-discover-390)

**F-01 Home has no promise, no car imagery, no WAV education.** H / M
Evidence: 01-home-1440. The H1 is "Find the right accessible vehicle", followed by a full-width purple button and then facet bars. A caregiver who has never bought a WAV learns nothing about ramp types, side or rear entry, or why they should trust the site. Fix: add a compact intro strip of three icon tiles (Who needs what: "I will drive from my chair", "I am a passenger in my chair", "I drive and transfer to the seat"). These map to entry type and conversion type. Each tile is a link that preselects filters. Keep it under 200px tall so BRAND.md "search first" still holds. Add one real hero image of a ramp deployed.

**F-02 Facet dashboard is the home page; no vehicle is shown.** H / M
Evidence: 01-home-1440, DiscoverPage.module.css:27-41 (3-column filterGrid). Make, Color, Model, State and so on all have equal weight. Fix: home shows, in order, (1) intro strip, (2) 4 curated entry filters (body type or make, entry type, price band, state), (3) "Newest arrivals" row of 6 listing cards (the single biggest "impression" gain), (4) "Browse all filters" link. Keep the full dashboard on /discover.

**F-03 Primary CTA is a 626px-wide purple slab with a second link floating next to it.** M / S
Evidence: 01-home-1440 ("See Matches" and "Browse all vehicles"). The CTA button stretches to the grid width and the secondary link sits far right, so they read as unrelated. "See Matches" is vague. Fix: sticky bottom action on mobile ("Show 6,840 vehicles"), and on desktop a 48px button capped at 280px with the result count in the label. The label should update live, like Airbnb or Zillow.

**F-04 Mileage slider reads "696kk+ mi" / "264kk+ mi".** H / S
Evidence: 01-home-1440, 02-results-filtered. The label appends "k" to something that is already formatted in thousands, and the axis is dominated by outliers. Fix: cap the axis at the 95th percentile (about 150k) with "150k+ mi", format via a single helper, and add a test for values 999, 1000, 150000 and 696000.

**F-05 Mobile discover overflows horizontally.** H / S
Evidence: 09-discover-390: "Browse all vehicles" is cut off at the right edge and the bars run off the screen. 06-results-390: the H1 and map are clipped. Probable cause: `.filterGrid { grid-template-columns: 1fr }` (DiscoverPage.module.css:27). A bare `1fr` has an implicit `min-width:auto`, so wide children (map SVG, histograms, min-content text) blow out the track. Fix: use `minmax(0,1fr)` at every breakpoint, add `min-width:0` to the cards, and wrap the CTA row with `flex-wrap`. Verify with an overflow check at 320px and 390px.

**F-06 Colour swatches are grey for OEM colour names.** M / S
Evidence: 02-results (Mosaic Black, Lakeshore Blue, Summit White, Radiant Red Tintcoat all grey) and 01-home ("Burgundy" is a pale grey dot). Fix: normalise the colour to a family (Black, White, Silver, Gray, Blue, Red, Green, Gold, Brown, Burgundy, Beige) at ingest and facet on the family. Show the OEM name only on the vehicle page. Give every swatch a 1px inner ring (BRAND.md rule) so white and silver are visible.

**F-07 Facet list noise: "Make: Chevrolet 484 / Chevy 2", trims "1LT", "2500 HIGH ROOF", "1500 136 WB", Model "E", "2500" and "150".** M / M
Evidence: 02-results, 08-filters. Casing and alias normalisation belongs in ingest (the "Gmc 66 vs GMC 33" case from CONTEXT.md). Trim and model facets that show raw dealer strings make the product look unreliable. Fix: canonical make table, uppercase-acronym rules, hide facets whose top values have fewer than 10 listings, and group trims.

**F-08 Disabled facets render at 35% opacity (BarsRenderer.module.css bar:disabled).** M / S
Evidence: 02-results ("Has lift", "Hand controls" show a dash and are barely visible). Opacity 0.35 drops text contrast far below 3:1. Fix: when a facet has zero results, hide it, or keep it at full text colour with "0" and a strike or disabled affordance. Never fade text.

### (b) Results (02-results-filtered-1440, 03-...-tall, 06-results-390)

**F-10 No vehicles above the fold; the facet wall is about 1,250px tall at 1440 before the first car.** H / M
Evidence: 03-results-filtered-1440-tall: facets span y=150 to 1,290, and cards start at about y=1,400 (display scale). This is the most damaging layout issue on the site. Owner direction: filters across the top, collapsing to a chip summary after picking (feedback_filters_on_top_collapse). Fix: a single sticky filter bar with 5 to 6 primary controls (Make, Price, Entry type, Ramp, Year, Location) as popover menus, a "More filters" drawer for the rest, and active selections shown as removable chips. Remove the map and histograms from the results page. Keep them on /discover as an explorer. Cards start at y of about 260.

**F-11 "Your personalized vehicle matches" is wrong copy.** M / S
Evidence: 02-results. Nothing is personalised, and the owner has paused personalisation features (D7). It over-promises. Fix: "486 Chevrolet Traverse wheelchair vans" (dynamic H1 from the filters). Move "Bookmark this page to return to the same search" into a small "Copy link" icon button.

**F-12 Count and sort are far from the filters.** M / S
Evidence: 03-results ("486 vehicles found" and Sort sit below the facet wall). Fix: put count, sort and view (grid or list) in one row directly under the filter bar, with the count in `aria-live="polite"` (already present at filters/page.tsx:451).

**F-13 Listing card hides the data shoppers compare on, and shows an "illustration" photo.** H / M
Evidence: filters/page.tsx:181-238, filters/page.module.css:171-345; 03-results (the "Vehicle pictures shown are for illustration only" stock image is first). Missing on the card: ramp type, entry (side or rear), conversion brand, seller or dealer name, price drop, "no price" state. Price is white text on a dark gradient over the photo (cardImagePrice), which is low contrast over bright photos and hides the image. Price at 18px/800 is the same weight as everything else. The condition label ("Used") is plain text, not a badge. Images use `alt=""` (filters/page.tsx:187) while the card is a link, which is acceptable since the h2 names it, but there is no `width`/`height`, so the layout shifts. Fix: see card anatomy in section 5.

**F-14 Broken and stock images.** H / M
Evidence: 03-results bottom row: two cards with a broken-image icon and a grey gradient; the first two use a manufacturer illustration with a baked-in watermark. Fix: `onError` swap to a branded placeholder (Car icon plus "Photo coming soon"); prefer a real dealer photo over a stock illustration when `images.length > 1`; flag stock images (hash or filename) at ingest and demote them. Never render a broken-image glyph.

**F-15 Hover colour is orange (rgba(184,92,0,.35) border, filters/page.module.css:~13) and the placeholder is a tan gradient (#f5ede3 to #e8d5c4).** L / S
These are leftovers from an earlier orange theme and clash with violet. Fix: tokenise to `--clr-primary` at 35% alpha and the surface tint.

**F-16 Pagination is two chevrons and an unlabeled info span.** M / S
Evidence: filters/page.tsx:267-296. The text lives in `paginationInfo` with `aria-current="page"`. That is accessible but gives no jump or total. Fix: "Page 3 of 41" plus first/last, or "Show more" infinite append with a count ("Showing 24 of 486"). Preserve scroll position on back-navigation.

**F-17 No loading skeletons for the results grid.** M / S
No `loading.tsx` found for filters or results (only listings/[id]/loading.tsx). Fix: 6 skeleton cards with the same aspect ratio, shimmer disabled under `prefers-reduced-motion`.

### (c) Vehicle detail (04-vehicle-1440, 05-vehicle-390)

**F-20 Page is `position:fixed; inset:0` with internal scroll (listings/[id]/page.module.css:2-12).** H / M
This disables native scroll restoration, pull-to-refresh and browser find, breaks iOS URL-bar collapse, and makes the page non-linkable to sections. It also causes the dead area under the gallery in 04-vehicle-1440 (the gallery is `flex:1` with `object-fit:contain; object-position:top`). Fix: a normal document flow page. Desktop: two-column grid, with a sticky right rail (price, key facts, CTA) and a scrolling left column (gallery, then sections). Mobile: single column with a sticky bottom CTA bar.

**F-21 Gallery shows one photo and 7 dots; 38 images exist.** H / M
Evidence: 04-vehicle-1440; PhotoGallery.tsx shows dots through `getVisibleDotIndices` and `showExpand={false}` on this page (detail-page.tsx), so there is no lightbox, no photo count and no thumbnails. Fix: hero (16:10) plus a 2x2 thumbnail mosaic with "+34 photos" overlay opening the lightbox (already built in PhotoGallery, just enable `showExpand`). Mobile: swipe carousel with a "3 / 38" counter in the corner instead of dots (dots do not scale past 7 and 7 tiny dots are below 44px touch targets). Preload the first image, lazy-load the rest, show a blurred placeholder. Lead with a category chip row (exterior, interior, ramp) when `imageCategories` exist.

**F-22 Price block is small, purple, and carries an unexplained "Est. $1,189/mo".** H / S
Evidence: OverviewTab.tsx; tabs.module.css:72-83 (`.price` at 2rem/700 is fine; `.priceMo` at 0.625rem = 10px). 10px text is below any readable minimum. The estimate has no stated term, APR or down payment, and WAV price should not be presented with a finance estimate we cannot back up. Fix: price at 32px/700 text colour (not violet); under it a 14px "Estimated payment" link that opens a popover with assumptions (term, rate, down payment) and lets the user edit them; or remove it until it is honest. Show "Price drop $2,000 on Oct 3" as a green pill with an icon, not 10px text.

**F-23 Spec chips are 11px with 11px icons.** H / S
Evidence: tabs.module.css:138-144 (`.chip` 0.6875rem). "Gas I4 2.5L/" has a trailing slash (data bug), "Gasoline Fuel" repeats the engine chip, the fuel icon is `TrendingUp` (wrong metaphor), and colour uses a bare "◆" glyph. Fix: a 2x3 fact grid with 16px icons and 14-15px values; labels ("Mileage", "Engine", "Transmission", "Colour") at 12px muted. Use `Fuel`, `Palette`, `Cog`, `Gauge` icons. Hide a fact when empty, rather than stretching the grid. Clean values at ingest ("2.5L I4 gas").

**F-24 The most important WAV facts are buried in a tab and mostly missing.** H / M
Evidence: detail-page.tsx tab order starts with WAV but the page opens on Overview (04-vehicle-1440); 96% of listings have `rampType='unknown'` and 65% have `conversionType='unknown'` (CONTEXT.md). Fix: promote a "Wheelchair access" summary block above the tabs, always shown: Entry (side/rear), Ramp (in-floor/fold-out) or Lift, Conversion brand, Floor lowering, Chair capacity, Seats. Unknown values show "Not stated by seller. Ask: [what to ask]" with a copyable question, not silence. See section 6.

**F-25 Tabs hide content and the order is wrong.** M / M
Evidence: tabs.module.css (`.tab` 11px, 56px min width). Five tabs with 14px icons at 11px text is too dense, especially at 390px (05-vehicle-390 shows the 5th tab cut off; only 4 are visible). Fix: replace the tabs with anchored sections on one scrolling page plus a sticky in-page nav ("Access", "Details", "Seller", "Price history", "Safety"). Progressive disclosure through accordions only for long content (recalls, history). Tabs should remain only if state (like Market) is genuinely optional.

**F-26 CTA hierarchy is weak.** H / S
Evidence: 04-vehicle-1440. The primary CTA "View seller listing" sits mid-column after the dealer block, beneath it "Is this listing still available?" (outlined) and a flag icon float right with unclear grouping. The CTA is a link to another site, which is not "contact the seller". The phone number (the real conversion action) is a text link. Fix: a primary "Call (866) 577-0794" (tel: link) and a secondary "Visit dealer site" in the sticky bar. Move "Is this still available?" and "Report" into a "..." overflow menu or footer of the seller block. See wireframes.

**F-27 Staleness warning is wrong for a 42-hour-old listing.** M / S
Evidence: 04-vehicle-1440: "Last verified 42 hours ago" plus the orange "may no longer be available" warning. `isVerificationStale` (listings/[id]/verificationUtils.ts) fires too early and trains users to ignore it. Fix: warn after 7 days (or relative to source cadence), show a positive "Verified today" signal otherwise, and put the date in a tooltip.

**F-28 "Also available at" duplicates the main seller.** M / S
Evidence: 04-vehicle-1440 shows the same dealer and price under "Also available at". Fix: filter `crossListings` where dealer and price equal the primary; show the section only for a different dealer, labelled "Same vehicle listed by another seller".

**F-29 Mobile bottom sheet covers the page and conflicts with scrolling.** H / M
Evidence: 05-vehicle-390: the bottom sheet peek (72px) sits over a gallery that leaves a large blank area; the Next.js "1 Issue" overlay is dev-only. The sheet has three snap points (peek 72px, mid 45dvh, full 8dvh; BottomSheet.module.css:30-45), custom drag, and a backdrop that is black at inline opacity. It cannot be linked or searched in the page and may trap a screen-reader user. Fix: remove the sheet; use the single-column page with a sticky bottom bar (price + Call). If the sheet stays, the peek should contain price and the Call button.

**F-30 Seller block is thin and lacks trust.** M / S
Evidence: DealerCard.tsx. It has a name, "Dealership" and a phone (only 11% of listings have one, so most pages show no phone). Missing: hours, rating (DealerReputation exists but only renders when Google data exists), NMEDA badge (exists, but in the WAV tab), distance from the user, and the number of listings. Fix: a seller card with the avatar or logo, rating, "Certified mobility dealer (NMEDA)" badge, hours today, and the Call and Visit buttons.

**F-31 Header title is truncated (`white-space:nowrap; text-overflow:ellipsis`, page.module.css:~60).** L / S
The vehicle name is the H1 and is cut at 390 wide. Fix: allow two lines, or put a full-size H1 in the body and make the sticky header compact (price only once scrolled).

### (d) VIN lookup and history (07-vin-1440)

**F-35 VIN page is clear but sparse; the input border is 1.45:1.** M / S
Evidence: 07-vin-1440. `--clr-border` #d8d3f2 on white is 1.45:1, which fails WCAG 1.4.11 (3:1 for the boundary of an input). The 17-character placeholder in a lighter grey is about 2.8 to 3:1 in the screenshot, so it also fails 4.5:1 for text. Fix: input border `--clr-border-strong` darkened to at least 3:1 (about #8a82b8), placeholder at muted #6a5f92 (5.73:1).

**F-36 No example, no inline validation, no explanation of where to find the VIN.** M / S
Fix: "Where is my VIN?" disclosure (dashboard, door jamb, listing), a sample VIN button, live counter "12 / 17", and an inline error that names the invalid character (I, O and Q are not allowed). Offer to paste from the clipboard. The "What you will see" box should be a 3-icon row (recalls, complaints, crash ratings), not a paragraph.

**F-37 The VIN page is the only page with a nice left-aligned layout (288px indent) and it does not match header width (208px).** L / S
Evidence: 07-vin-1440: logo at x=208, content at x=288, footer at x=208. Fix: one container width and one left edge across all pages (`max-width: 72rem; margin-inline: auto; padding-inline: 1rem`).

### (e) Filters pages (08-filters-1440)

**F-40 /filters repeats /discover and /results with a different heading.** M / M
Evidence: 08-filters-1440 versus 01 and 03 (same facet wall, three routes: discover, results, filters). Users cannot tell the three apart. Fix: collapse to two (home and results). Redirect /filters and /discover to them, or give /discover the explorer role only.

**F-41 Facet groups use identical 12px-radius violet-tinted cards and 44px bars.** M / S
Evidence: FilterGroup.module.css:3-12 (`background: rgba(92,53,198,.04)`), BarsRenderer.module.css:`.bar` (min-height 2.75rem, `.fill` background var(--clr-border)). Every group is a card (against BRAND.md), the bars are full-width and 44px tall (which wastes space: a 7-item list is 330px), and the fill colour is the border colour, giving only 3.96:1 against the muted text on top of it. Fix: no card (just a heading and divider); 36px rows inside a popover; fill `--clr-primary-light`; count right-aligned; selected state shown with a check icon, not colour alone (BRAND.md).

**F-42 Group title labels are 13px uppercase muted violet; "Show 92 more" is a 13px underlined link.** L / S
Fix: titles at 14px/600 in sentence case (uppercase tracking harms readability for long words); "Show more" opens a searchable modal (FacetModal exists), so give it a search field when the list has more than 15 items.

**F-43 Map is the only way to filter by place on desktop and it is clipped on mobile.** M / M
BRAND.md: "Maps must not be the only way to access listing locations". The state list exists, so it is met, but the map is decorative on results. Fix: ZIP plus radius input ("within 100 miles of 48104") as the primary location control, and the map as a secondary explorer on /discover.

### (f) Header, footer, nav, language switcher

**F-45 Header has no navigation.** M / S
Evidence: SiteHeader.tsx. A logo, a two-line tagline at `clamp(0.5625rem,2.2vw,0.75rem)` (9px minimum, unreadable on mobile) and a language select. 01-home shows a "Discover" link only on home. There is no link to Browse, VIN check, or About, so VIN lookup is undiscoverable (no path from the header to /vin). Fix: logo, then "Browse vehicles", "VIN check", "How it works" (icons on mobile), and a globe icon button for language. Tagline moves to the home hero. Header is `position:sticky` with backdrop blur at 48% white (globals.css:98); text contrast is fine, but the blur is an unnecessary performance cost on low-end phones.

**F-46 Language switcher is a native `<select>` showing "English".** L / S
Evidence: LanguageSwitcher.module.css:21-35. It is accessible and labeled (`.label` is sr-only), height 2rem (32px) which is below 44px, and the chevron stroke is #888 (3.54:1 on white, a non-text contrast fail by a small margin). Fix: a `Languages` (lucide) icon button with the two-letter code ("EN") and an accessible name, 44px target, or keep the select with `min-height:2.75rem` and a darker chevron.

**F-47 Footer is a copyright plus 3 bare icons (shield, scroll, bot) with only aria-labels.** M / S
Evidence: 07-vin-1440 (footer at the bottom right: three 15px icons). Icons-over-words is the owner's preference, but legal links are a case where words are the right call: nobody recognises a scroll as "Terms" or a robot as "About our crawler", and 15px is below the 24px minimum target (WCAG 2.5.8) and 44px recommendation. Sighted users get no label. Fix: text links "Privacy · Terms · Data sources · Crawler policy" at 14px with a 44px line height, then the disclaimer. Add contact and source attribution (trust).

**F-48 BRAND.md describes seasonal theming and a theme switcher that do not exist in code.** M / S
Evidence: BRAND.md section "Seasonal Themes" versus globals.css (single violet palette, no `data-theme`, no dark mode, no `prefers-color-scheme`). Either implement or delete the section. My recommendation is to delete it. Seasonal hue rotation harms brand recognition and trust for a medical-adjacent purchase, and it would double the contrast-testing matrix. Keep one brand palette and add a dark theme later only if needed.

### (g) Typography, colour, spacing, motion

Measured contrast (text on white unless stated):

| Token | Value | Pair | Ratio | Verdict |
|---|---|---|---|---|
| text | #100e1a | on #fff | 19.1 | pass |
| text-secondary | #3d3568 | on #fff | 11.0 | pass |
| text-muted | #6a5f92 | on #fff | 5.73 | pass AA |
| text-muted | #6a5f92 | on surface #f8f7fe | 5.38 | pass AA |
| text-muted | #6a5f92 | on bar fill #d8d3f2 | 3.96 | fail AA (text), see F-41 |
| text-muted | #6a5f92 | on violet tint #ebe8fb | 4.77 | pass, thin margin |
| primary | #5c35c6 | on #fff, and white on primary | 7.55 | pass AAA |
| primary | #5c35c6 | on primary-light #f0eeff | 6.61 | pass |
| warning-text | #92400e | on #fff | 7.09 | pass |
| warning | #b45309 | on #fff | 5.02 | pass |
| feature green | #166534 | on #dcfce7 | 6.49 | pass |
| neutral-muted | #64748b | on #fff | 4.76 | pass |
| border | #d8d3f2 | on #fff | 1.45 | fail non-text 3:1 for inputs |
| border-strong | #bdb8e2 | on #fff | 1.89 | fail non-text 3:1 for inputs |
| language chevron | #888 | on #fff | 3.54 | marginal pass non-text |
| VIN placeholder | about #9a95b5 (screenshot estimate) | on #fff | about 2.8 to 3 | fail 4.5:1 |

Note: the globals.css comment says muted is "5.73:1 on white", which matches. The numbers are healthy. The text palette is the strongest part of the system. The failures are borders and placeholders.

**F-50 Type scale is ad hoc: 9, 10, 11, 11.5, 12, 13, 14, 15, 16, 17, 18, 22, 24, 32 px appear across CSS modules.** H / M
Evidence: tabs.module.css (0.625rem used 9 times, 0.6875rem 10 times); SiteHeader (clamp from 9px); Tabs.module.css `.tab` 11px. Anything under 12px fails the owner's scanability goal and is hard for older caregivers and low-vision users. Fix: adopt the scale in section 4 and ban sizes below 12px except legal text. A stylelint rule can enforce this (`declaration-property-value-allowed-list` for `font-size`).

**F-51 Uppercase micro-labels with letter-spacing (0.04 to 0.07em) are everywhere.** M / S
Evidence: FilterGroup `.title`, tabs `.sectionLabel`, VIN eyebrow. Used in 15+ places so it stops signalling hierarchy. Fix: reserve for one "eyebrow" style per page.

**F-52 Whole app sits on a lavender radial-gradient body (globals.css:114-118) with 48% glass cards and blur.** M / S
This is the "soft tinted neutral" the owner wants, and the tint is fine, but gradient plus `backdrop-filter` on every card (filters/page.module.css `.card`, FilterGroup, tab list) adds paint cost and lowers edge definition (white 68% on lavender gives almost no separation, border 1.45:1). Fix: flat page ground (#faf9ff), white cards with a 1px `--clr-border` and a restrained shadow; keep the gradient to one hero area. Remove `backdrop-filter` except on the sticky header.

**F-53 Spacing is ad hoc (0.1875, 0.3125, 0.4375, 0.5625, 0.8125 rem...).** M / M
Fix: a 4px scale (section 4). Gaps between facet groups are 1.5rem but only 0.1875rem between bars, so rhythm feels cramped inside and loose outside.

**F-54 Motion: card hover lifts 2px and scales the image 1.04 over 0.35s; sheet snaps in 0.32s; reduced-motion is globally honoured (globals.css:180-188).** L / S
Reduced-motion handling is good. Fix: keep the card hover (also gate it with `@media (hover:hover)` to avoid sticky hover on touch; filters/page.module.css has the rule at ~352, verify); add a gallery crossfade (150ms), a sticky bar slide-in (200ms ease-out) and a number count-up on the results count (disabled under reduced motion). Do not add scroll-jacking.

**F-55 No dark mode.** L / L
Acceptable given the audience (daytime shoppers). Do not add until the token system is cleaned (F-56).

**F-56 Tokens are duplicated three ways: `--color-*` (Tailwind @theme), `--clr-*` aliases, shadcn HSL vars, and many hard-coded rgba values (e.g. rgba(184,92,0,...), rgba(92,53,198,.04)).** M / M
Evidence: globals.css:4-109. BRAND.md asks for semantic tokens and says "Do not hard-code hex values inside components". LanguageSwitcher.module.css had an undefined `--color-primary-solid` bug (comment at lines 30-36), proof the duplication bites. Fix: one token layer (`--clr-*`), generate Tailwind and shadcn from it, lint for raw hex in module CSS.

### (h) Iconography

Where icons are used well: footer (but see F-47), card meta (Gauge, MapPin, 14px with aria-hidden and sr-only unit), tabs, dealer card (Phone, Globe, MapPin), gallery controls (all have aria-labels: previous, next, expand, close, photoOf).

**F-60 Icons that are wrong or inconsistent.** M / S
Evidence: OverviewTab.tsx fuel chip uses `TrendingUp` (a chart arrow for fuel); engine uses `Cog`, transmission `Settings2`, colour uses a text "◆"; WavDetailsGrid uses `ArrowUpDown` for lift, `MoveDown` for both floor lowering and kneel, and `Users` for wheelchair capacity (a group of people, not a wheelchair). Fix: `Fuel`, `Cog`, `Gauge`/`Settings2` for transmission, `Palette`, and lucide `Accessibility` or a custom wheelchair-with-width glyph for capacity. Use one icon per concept across card, chips and WAV grid (a single `icons.ts` map).

**F-61 Words that should be icons (owner preference), with accessible names.** L / S
- Card meta "Used" and "New" to a condition badge with `BadgeCheck` or text only for "New"; keep text for clarity.
- Header "Discover" to `Compass` with a visible label on desktop.
- Pagination already uses icons.
- Language switch to `Languages`.
- Seller actions: Call (`Phone`), Visit (`ExternalLink`), Report (`Flag`, already an icon-only button; confirm it has an aria-label), Share (`Share2`).
Keep words where the icon is ambiguous: ramp types, legal links, Safety.

**F-62 Icons that need an accessible name or text.** M / S
Evidence: the flag button in 04-vehicle-1440 (icon-only; check ReportListingForm.tsx for `aria-label`); tab icons are `aria-hidden` and the labels carry the name (good); card badges `NewBadge` (client-only, `aria-label` unverified). Run the wav-a11y-audit skill to confirm.

**F-63 Missing icons where they would speed scanning.** M / S
Evidence: facet bars have none; the listing card WAV badges are plain green text pills (`.badgeGreen`) with no icon, so "side entry" and "rear entry" look identical in shape. Fix: ramp (in-floor/fold-out), side-door and rear-door glyphs on the card badges and in filter chips; entry type is the number 1 WAV decision.

**F-64 Conversion-brand "logo" is a text abbreviation tile (`abbreviate(displayName)` in WavConversionInfo.tsx:83).** L / S
"BA" for BraunAbility reads as a placeholder. Fix: use the brand logo (licensed or text mark) or just the name at 18px with the NMEDA badge.

### (i) Trust and conversion

What makes a shopper contact a seller: confidence the vehicle is real, current and fits, plus a one-tap action. Current state is thin on all three.

**F-70 Phone is present on only 11% of listings, and the only CTA is "View seller listing" (outbound link).** H / M
Evidence: CONTEXT.md fill rates (dealer phone 11%, dealer name 84%); OverviewTab.tsx CTA block. Most pages therefore offer a single link out. Fix: backfill phone from the dealer profile or Places data (DealerReputation already ingests Google Places); when no phone exists, label the CTA "Contact [dealer name] on their site" and show the dealer's address and hours. Track outbound clicks (measure conversion; also needed to report value to dealers).

**F-71 Price clarity: 18% of listings have no price and show "Call for price".** M / S
Fix: card shows "Call for price" with a phone icon and sorts to the end by default; add a "Hide listings without price" toggle (default on for price-sorted views).

**F-72 No data-provenance trust signals near the CTA.** M / S
Fix: next to the CTA: "Listed by Freedom Motors on freedommotors.com. Checked today." with a source favicon. Show "NMEDA member" and "Google rating 4.6 (212)" where available. Show VIN and a "Run safety check" link (the VIN page is a differentiator that is currently buried: F-45).

**F-73 Disclaimer box ("Listing data: Price, availability...") is boxed with an info icon in muted type at the bottom (tabs `ListingDisclaimer`).** L / S
It is legally sensible but visually looks like an error. Fix: one muted line under the seller block.

**F-74 No price context on the main view.** M / M
The Market tab holds the comparison (MarketComparison, MileageGauge, price sparkline) but 90% of users will never open it. Fix: a one-line verdict in the price block ("$4,200 below similar 2023 Traverse vans in your area", with a mini bar) linking to the detail section. Only show when n of comparables is at least 5.

**F-75 No sticky contact on mobile; no share or save.** M / M
Share is allowed (no watchlist is the pause, not share). Add `Share2` (native share sheet). Saving stays out per D7.

### (j) WAV-specific information design (non-expert caregiver)

Current: WavTab shows `WavConversionInfo` (brand tile, matched product, entry banner), `WavDetailsGrid` (rows: features, floor lowering, ramp type, "WC capacity", conversion status), history, NMEDA dealers nearby. Strengths: entry banner with icon (DoorOpen/Truck) and a short sub-line; "needs verification" state for conflicting data (never colour only). Gaps:

**F-80 Jargon without explanation.** H / M
"In-floor ramp", "Fold-out ramp", "Fold-in ramp", "Floor lowering 10 inches", "WC capacity" (abbreviation, against the owner's no-abbreviation rule; WavDetails messages `wcCapacity`, also the filter label `wcCapacityLabel`), "Transfer seat", "Kneel system", "Securement" (not present at all), "Conversion status: Proposed/Complete". A caregiver does not know whether an in-floor ramp matters or what "lowered floor 10 inches" means for head room. Fix: each row gets a one-line plain-language sub-label and an info popover with a diagram. Example copy:
- Entry: "Side entry. You get in from the kerb side; you can park in a normal space with room beside it for the ramp." / "Rear entry. You get in from behind; it needs space behind the van and often keeps the passenger seats."
- Ramp: "In-floor ramp. Slides out of the floor, stays out of the way indoors, can be used when you cannot open all doors." / "Fold-out ramp. Folds up and sits inside the doorway; usually lower cost."
- Floor lowering: "Floor lowered 10 in. More head room for a tall person in a wheelchair." with a target (a typical chair plus rider needs about 56 in).
- Wheelchair capacity: "Carries 1 wheelchair" (spell out, no WC).
- Securement: "Wheelchair lock-down: not stated".

**F-81 Seat count and seating layout are absent.** H / M
Evidence: no field in WavDetailsGrid or the card. This is the second most asked question after entry. Fix: "Seats 5 including driver; 1 wheelchair position" row, and a small top-down seat diagram (grey seats, blue wheelchair position). Needs the data; at minimum derive from the factory seat count minus the conversion.

**F-82 Lift versus ramp is conflated.** M / S
`has_lift` is a feature chip (ArrowUpDown icon) while ramp type is a different row. Fix: one "How the wheelchair gets in" row with a single value: "Ramp (in-floor, power)" or "Lift (platform, vans only)". Never show both rows with different icons.

**F-83 Unknown is silent.** H / S
96% of ramp types and 65% of conversion types are unknown, so most WAV tabs show an empty or sparse grid and the user cannot tell "no ramp" from "we do not know". Fix: always render all six WAV rows (Entry, Ramp or lift, Conversion brand, Floor lowering, Wheelchair capacity, Seats). Unknown rows show a dashed `HelpCircle` icon, "Not listed", and a "Ask the seller" popover with the exact question. Show a completeness meter on the card ("WAV details: 2 of 6 known") so shoppers prefer listings with data and dealers are nudged to supply it.

**F-84 Conversion brand, product and NMEDA are in a tile, not a decision aid.** M / M
Fix: brand name (text) plus "NMEDA-certified dealer nearby: 3 within 50 miles" as a single line with `ShieldCheck`; "What this conversion means" link to a short explainer page per brand (conversion-brands endpoint exists).

**F-85 No "can I use this" screening.** L / L
Later phase: a 3-question helper (chair width, rider height, transfer or drive from chair) to filter listings by compatible floor lowering and ramp width. This is the signature moment.

## 2. Card anatomy (listing card), recommended

- Image 4:3, `object-fit: cover`, hero chip bottom-left "12 photos", top-left status chip ("New to site", "Price drop $2,000") with an icon; no gradient, no price over the photo.
- Row 1: price at 22px/700 (text colour) and, right-aligned, mileage at 14px.
- Row 2: title "2021 Chevrolet Traverse RS" at 16px/600, one line with ellipsis, and a muted 14px trim/conversion line.
- Row 3 (the WAV strip, the point of the product): up to 3 icon chips at 13px/600, 28px tall, each with an icon and text: Side entry, In-floor ramp, 1 chair. Unknown items collapse to "WAV details not listed" in muted text.
- Row 4: location and dealer (MapPin, 14px muted), with a 24px dealer logo or initials.
- Footer: nothing. The whole card is the link (already true; keep the focus ring).
- Width: 3 columns at 1200, 2 at 600, 1 at under 600 with a horizontal layout (120px thumb) only if density is wanted.
- States: skeleton, broken-image fallback, no-price ("Call for price" with `Phone`).

```
Desktop card (about 360 x 400)
+------------------------------------+
| [ photo 4:3                       ]|
| [Price drop $2,000]      [12 photos]|
|                                    |
+------------------------------------+
| $68,990                  19,350 mi |
| 2021 Chevrolet Traverse RS         |
| Freedom Motors conversion          |
| [door Side entry][ramp In-floor]   |
| [chair 1 wheelchair]               |
| (pin) Villa Park, IL  . Freedom M. |
+------------------------------------+

Mobile card (390 wide, one column)
+------------------------------------+
| [ photo 16:10 ............ 1/12 ]  |
| $68,990 . 19,350 mi                |
| 2021 Chevrolet Traverse RS         |
| [Side entry][In-floor][1 chair]    |
| Villa Park, IL . Freedom Motors    |
+------------------------------------+
```

## 3. Vehicle page, recommended

Principles: native scroll, sticky rail on desktop, sticky bottom bar on mobile, one answer per question, WAV facts before generic specs.

```
DESKTOP (1280)
+----------------------------------------------------------------------+
| < Results   WivWav   Browse  VIN check  How it works         [EN]     |
+----------------------------------------------------------------------+
| 2026 Chevrolet Traverse FWD LT          (share) (report ...)         |
| Battle Creek, MI . New . 21 mi . VIN 1GNE...                         |
+--------------------------------------------+-------------------------+
| [ HERO PHOTO 16:10                        ]| STICKY RAIL             |
| [thumb][thumb][thumb][ +34 photos ]        |  $75,981                |
|                                            |  $2,000 below similar   |
| Wheelchair access                          |  [Call (866) 577-0794]  |
|  Entry      Side entry (?)                 |  [Visit dealer site  ]  |
|  Ramp       In-floor ramp (?)              |  Freedom Motors         |
|  Conversion BraunAbility                   |  NMEDA . 4.6 (212)      |
|  Floor      Lowered 10 in (?)              |  Open today 9-6         |
|  Chair      1 wheelchair (?)               |  Checked today          |
|  Seats      Not listed (?) [Ask seller]    |  Payment estimate (?)   |
|                                            +-------------------------+
| Vehicle details (6-up fact grid)           |
| Price history . Market comparison          |
| Safety and recalls (summary + link)        |
| Similar vehicles (3 cards)                 |
+--------------------------------------------+
```

```
MOBILE (390)
+--------------------------------+
| <  2026 Chevrolet Traverse  (s)|
+--------------------------------+
| [ swipe photo 4:3      3 / 38 ]|
+--------------------------------+
| $75,981                        |
| $2,000 below similar . New     |
| Battle Creek, MI . 21 mi       |
+--------------------------------+
| Wheelchair access              |
| [door Side entry] [ramp In-fl.]|
| [chair 1] [10 in lowered]      |
| Seats: not listed [Ask seller] |
+--------------------------------+
| Vehicle details  (2x3 grid)    |
| Seller . hours . rating        |
| Price history, Safety (accordn)|
+--------------------------------+
| STICKY BAR (safe-area padded)  |
| $75,981   [ Call ]  [ Visit ]  |
+--------------------------------+
```

Sticky mobile bar: 64px plus `env(safe-area-inset-bottom)`, price left, Call (primary, 48px tall), Visit (secondary icon button with name). Hide it while the keyboard is open. Add bottom padding to the page equal to the bar height so nothing is covered.

## 4. Visual system (concrete values)

Type (Plus Jakarta Sans already loaded; keep it):

| Role | Size / line | Weight | Use |
|---|---|---|---|
| Display | clamp(32px, 5vw, 44px) / 1.1 | 700, tracking -0.02em | Home H1 only |
| H1 | clamp(24px, 3.5vw, 32px) / 1.2 | 700 | Page titles |
| H2 | 20px / 1.3 | 650 | Section titles |
| H3 | 16px / 1.4 | 600 | Card titles, group titles |
| Price (detail) | 32px / 1.1 | 700 | Detail page only |
| Price (card) | 22px / 1.2 | 700 | Cards |
| Body | 16px / 1.5 | 400 | Paragraphs |
| UI / meta | 14px / 1.4 | 500 | Chips, meta, buttons |
| Caption | 12px / 1.4 | 500 | Legal, counts, minimum size |

Rule: no size below 12px; no uppercase tracking except one eyebrow style. Use tabular numerals (`font-variant-numeric: tabular-nums`) for prices, counts and mileage.

Spacing (4px base): 4, 8, 12, 16, 24, 32, 48, 64. Page gutter 16px mobile, 24px tablet, 32px desktop; container 72rem. Section gap 48px desktop, 32px mobile. Card padding 16px. Tap targets at least 44px.

Colour usage (keep the violet; make it earn its place):
- Ground: flat #faf9ff. Cards: #fff with 1px #d8d3f2 and a soft shadow `0 1px 2px rgba(16,14,26,.06)`. Input borders: #8a82b8 or darker (3:1 or more).
- Violet #5c35c6 only for primary actions, links, selected states and focus. Prices in text colour #100e1a.
- WAV facts use a second hue so they read as "the thing we are about": teal-green (#0f766e on #ccfbf1, check 5.5:1 or more) for access chips; keep the existing green for "price drop". Status colours stay fixed per BRAND.md and always pair with an icon.
- Soft tinted neutrals (owner preference) come from the ground and `--clr-primary-light` fills, not from near-black sections.

Motion: 150ms ease-out for hovers, 200ms for the sticky bar and popovers, 250ms gallery crossfade. All gated by the existing reduced-motion rule.

Remove:
1. The facet-group card fill and per-group borders (F-41).
2. `backdrop-filter` everywhere except the sticky header (F-52).
3. The map and histograms from /results (F-10); decide on /filters (F-40).
4. The bottom sheet and the fixed-position page shell (F-20, F-29).
5. The gradient overlay and price-over-photo on cards (F-13).
6. The tagline from the header (F-45).
7. The "Also available at" duplicate (F-28), the "Gasoline Fuel" chip when the engine says gas (F-23), the 10px "Est. monthly" line (F-22).
8. The seasonal-theme section in BRAND.md (F-48).
9. Dev-only Next.js "Issue" badge appears in every screenshot: confirm it is absent in production.

## 5. Accessibility summary (WCAG 2.1 AA lens)

Good: skip link and focus reset (globals.css:131-177), 3px focus ring token, global reduced-motion, forced-colors handling for card price, 44px minimum on bars and tabs, `aria-live` on the result count, carousel semantics and aria-labels in PhotoGallery, icons mostly `aria-hidden` with sr-only text, no colour-only status in WavDetailsGrid.

Gaps, in priority order:
1. Non-text contrast: input and card borders 1.45:1 (F-35, F-52). 1.4.11.
2. Text size: 9 to 11px in header, tabs and chips (F-50). Not a hard AA fail, but fails the WAV audience (older caregivers, low vision). 1.4.4 reflow at 200% will also clip the nowrap header and chips.
3. Reflow at 320px: horizontal overflow on discover and results (F-05). 1.4.10.
4. Disabled facets at 35% opacity (F-08). 1.4.3.
5. Target size: language select 32px, footer icons 15px, gallery dots (F-21, F-46, F-47). 2.5.8 (AA in WCAG 2.2; the repo targets 2.1 but states 44px elsewhere).
6. Bottom sheet: custom drag, three snap points and a backdrop. Confirm focus trap, Escape, `aria-modal` and inert background, or remove (F-29). 2.1.1, 2.4.3.
7. Fixed-position page shell with internal scroll can break keyboard scrolling and zoom (F-20). 1.4.4, 1.4.10.
8. Hover-only affordances: gate with `@media (hover:hover)`.
9. Placeholder contrast on the VIN input (F-35).
Run the `wav-a11y-audit` skill (axe plus jsx-a11y) before and after phase 1 to turn these estimates into evidence.

## 6. Ranked top 20

1. F-10 Results: facets above cards. Move to a sticky top filter bar with chips, cards at about y=260. (H / M)
2. F-20 + F-29 Detail page: drop the fixed shell and bottom sheet; native scroll, sticky rail and sticky mobile bar. (H / M)
3. F-26 + F-70 CTA: Call as primary, Visit as secondary, move "still available" and Report into a menu. (H / S-M)
4. F-13 Listing card: new anatomy with WAV strip, price below photo, status chip. (H / M)
5. F-24 + F-83 WAV block promoted above the tabs, six rows always shown, "Ask the seller" for unknown. (H / M)
6. F-21 Gallery: hero plus mosaic, counter, lightbox on. (H / M)
7. F-05 Mobile horizontal overflow (`minmax(0,1fr)`). (H / S)
8. F-04 Mileage label "kk" and outlier axis. (H / S)
9. F-14 Broken and stock images: fallback, demote stock. (H / M)
10. F-80 Plain-language WAV explanations (and spell out "WC"). (H / M)
11. F-50 Type scale: nothing below 12px. (H / M)
12. F-02 Home: intro strip, newest arrivals, curated filters. (H / M)
13. F-23 + F-22 Spec chips and price block sizes; fix "Gas I4 2.5L/", fuel icon; remove or explain the monthly estimate. (H / S)
14. F-35 Input border and placeholder contrast (VIN and all inputs). (M / S)
15. F-25 Tabs to anchored sections (or at least 12px, 4 visible, scrollable with fade on mobile). (M / M)
16. F-81 Seat count and layout. (H / M, depends on data)
17. F-45 Header navigation (Browse, VIN check) and legible text. (M / S)
18. F-07 + F-06 Data hygiene in facets: make and colour normalisation. (M / M)
19. F-27 + F-28 Stale warning threshold and cross-listing dedupe. (M / S)
20. F-11 + F-12 Results heading copy, count and sort bar position. (M / S)

## 7. Three-phase plan

**Phase 1: Quick wins (about 1 week; mostly CSS and copy, one PR each)**
- F-04 mileage label; F-05 overflow fix; F-08 disabled facets; F-15 orange leftovers; F-22/F-23 chip and price sizes and values; F-27 stale threshold; F-28 dedupe; F-31 header title wrap.
- F-35 border and placeholder contrast; F-46/F-47 targets and footer text links; F-50 minimum 12px; F-45 header links.
- F-11 heading copy; F-12 count and sort row; F-14 image fallback; F-60/F-61 icon fixes.
- Run `wav-a11y-audit` before and after; fix whatever it flags.

**Phase 2: Structural (about 3 to 4 weeks)**
- F-10 sticky top filter bar with popovers and chip summary; remove map and histograms from results; F-40 route consolidation.
- F-13 new listing card and F-17 skeletons; F-16 pagination; F-02 home restructure.
- F-20/F-29 detail page rebuild: native scroll, sticky rail, sticky mobile bar; F-21 gallery; F-25 sections; F-24/F-83 WAV block; F-80 explanations; F-30 seller block; F-74 price verdict.
- F-52/F-53/F-56 token cleanup (one layer, one spacing scale, lint for raw hex and sub-12px sizes).
- Data: F-07 normalisation, F-06 colour families, phone backfill (F-70), seat count (F-81).

**Phase 3: Signature moments (ongoing)**
- Ramp-deployed hero photography on home and category landing pages (use real conversion photos with permission); "Day in the life" tiles for the three user types.
- F-85 "Will it fit?" helper (chair size, rider height, transfer or drive from chair) that scores listings and filters by floor lowering and ramp width.
- Interactive WAV explainers: animated side versus rear entry diagrams, ramp type visuals, seat-layout diagram on every vehicle page.
- Microinteractions: live result count on filter change, gallery crossfade, sticky bar slide-in, price-drop pill; all reduced-motion safe.
- Dealer trust layer: NMEDA badge, ratings, hours, response time; outbound-click analytics to prove value to dealers.
- Revisit dark mode only after tokens are unified (F-55); remove the seasonal theme section from BRAND.md (F-48).

## 8. Caveats
- Interaction (hover, focus, tab switching, sheet drag) was judged from code, not run.
- The placeholder contrast is estimated from the screenshot; the VIN input styles did not expose an explicit placeholder colour in the CSS I read.
- Findings F-62 (accessible names on the flag button and NewBadge) are unverified and listed as checks.
- The dev-only Next.js "1 Issue" badge appears in all screenshots and was excluded from the critique.
