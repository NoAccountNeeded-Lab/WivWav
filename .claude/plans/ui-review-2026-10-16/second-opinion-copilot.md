Read review context, brand rules, and pointed source. Then map screenshots to concrete findings.

Review scope: `audit`, `critique`, `layout`, `typeset`, `polish`, `harden` for `/discover`, `/results`, listing detail, VIN, and filters. `/private/tmp/review` was inaccessible, so screenshot filenames/evidence unavailable. Code evidence below.

## 1. Ten most damaging problems

1. **Detail page hides the primary action.** Mobile detail is `position: fixed` with `overflow: hidden`; content lives inside a bottom sheet starting at `peek` (`page.module.css:3-14`, `ListingSheet.tsx:10-17`). Users see a photo, then must discover and drag a sheet before contacting a seller. Add a fixed mobile action bar: `Contact seller`, `View original`, `Save`; keep price and location visible above it. Violates BRAND: detail pages prioritize conversion and seller contact.

2. **Vehicle identity is too small and truncated.** Header title is `0.9375–1.0625rem`, `white-space: nowrap`, and ellipsized (`page.module.css:52-60`). A buyer cannot reliably distinguish trim, drivetrain, or conversion variant. Use a two-line title block with year/make/model at 1.25–1.5rem, trim and location below.

3. **The information hierarchy treats WAV data as secondary.** `Overview` opens by showing price, generic mileage, engine, transmission, and fuel; WAV data requires another tab (`OverviewTab.tsx`, `WavTab.tsx`). For this product, entry type, ramp mechanism, floor lowering, wheelchair capacity, and transfer seat belong immediately below price. Move a compact WAV summary into the hero and keep full details in the WAV tab.

4. **Listing cards optimize for pretty imagery over comparison.** Price is overlaid on a dark gradient (`filters/page.module.css:203-254`), while title and facts are below. Cards omit conversion manufacturer, entry side, ramp type hierarchy, source freshness, and listed date. Put price, year/make/model, mileage, location, entry type, ramp type, and conversion brand in a stable text grid. Keep image decorative.

5. **Filter page is a wall of controls without a decision path.** Results use one full-width filter section, then cards; mobile has no persistent filter/sort/action affordance (`filters/page.module.css:35-70`). Add a sticky mobile row: `Filters`, result count, `Sort`. Show selected constraints first. Keep only high-value filters expanded: price, year, mileage, entry, ramp, wheelchair features.

6. **Discover is analytically dense but shopper-hostile.** Three columns contain charts and facet groups (`DiscoverPage.tsx:35-68`, `DiscoverPage.module.css:25-40`). Histograms and donut charts imply analysis instead of helping a buyer choose. Replace with plain, labeled controls and counts. Use charts only where distribution changes a decision, such as price and mileage.

7. **Typography is too compressed to establish hierarchy.** Detail tabs use many `0.5625–0.8125rem` labels and values (`tabs.module.css:25-61`, `479-641`). Tiny uppercase labels make critical facts look like metadata. Set body text to 1rem minimum, supporting text to 0.875rem, section labels to 0.75rem, and reserve uppercase for short eyebrow labels.

8. **Gallery navigation is weak and detail expansion is disabled.** Detail passes `showExpand={false}` (`detail-page.tsx`, gallery call near the gallery render). The gallery only gives dots and swipe; arrow controls are hidden until hover on pointer devices (`PhotoGallery.module.css:90-133`). Add visible thumbnail strip or labeled `View all photos`, show count, and enable full-screen viewing. Put photo evidence labels on the image, not only hidden semantic metadata.

9. **Visual styling competes with trust.** Glass backgrounds, blur, radial gradients, shadows, image gradients, and hover zoom appear across results/detail (`filters/page.module.css:95-123`, `page.module.css:3-14`). This reads like a generic lifestyle marketplace, contrary to BRAND’s calm, restrained direction. Delete glassmorphism, radial backgrounds, image zoom, and decorative gradients. Use solid surfaces, one border, and one accent.

10. **The UI hides uncertainty instead of making it useful.** Types include `vehicleModelMatchConfidence` but mark it “not currently rendered” (`listings/[id]/types.ts:17-21`). Unknown and conflicting WAV fields are handled, but confidence, evidence count, and verification age are not consistently surfaced. Add field-level provenance: `Verified`, `Seller-reported`, `Inferred from photos`, `Needs confirmation`, with date and source.

## 2. What WAV shoppers still need

Vehicle page and cards lack the dimensions that determine whether a chair and caregiver fit:

- Door opening width and ramp usable width.
- Ramp length, slope, deployed clearance, and manual/power operation.
- Interior floor height and lowered-floor dimensions.
- Headroom, wheelchair position, tie-down count, and occupant capacity.
- Passenger-seat removal or transfer-seat availability.
- Lift platform dimensions and lift capacity.
- Conversion year, conversion mileage, installer, warranty, and service history.
- Whether the listing photos prove the claimed equipment.
- Exact seller location, distance, seller hours, financing/payment expectations, and appointment/contact path.
- Confidence and freshness per WAV fact.

The page has `floorLoweringInches`, `wheelchairCapacity`, conversion history, and photo claims in types/components, but presents them as sparse rows rather than a buyer-ready fit checklist (`WavDetailsGrid.tsx:70-127`, `types.ts:3-14`).

## 3. Icon problems and opportunities

- Icons are too small beside already-small text: 11–16px in overview/chips (`OverviewTab.tsx`, `tabs.module.css:109-139`).
- `TrendingUp` represents fuel type, which is semantically wrong (`OverviewTab.tsx`).
- A decorative diamond represents vehicle color. Use a labeled color swatch with text.
- Metadata separators are CSS dots, not clear groups (`filters/page.module.css:323-328`).
- Keep icons for entry direction, ramp/lift, wheelchair capacity, location, phone, external source, and verification.
- Pair every icon with a visible label. Never use an icon as the only meaning.
- Replace generic `Settings2` with drivetrain/transmission-specific icons or no icon.

## 4. DB/API data missing or misrepresented

- `vehicleModelMatchConfidence` exists but is intentionally unused (`types.ts:17-21`).
- Listing cards receive `sourceUrl`, `listedAt`, `conversionType`, `rampType`, `wavFeatures`, and images, but omit source, freshness, conversion manufacturer, color, fuel, and seller identity (`filters/page.tsx` listing type near lines 15-33).
- Detail has `sourceListedAt`, `sourceUpdatedAt`, `scrapedAt`, and `detailScrapedAt`, but these are buried in footer metadata or verification text (`OverviewTab.tsx`).
- `priceCents: null` becomes “Call for price”; distinguish missing price from seller-requested price.
- `condition` falls back to “unknown,” but unknown data needs visible provenance, not a neutral badge.
- `fieldResolution` exposes conflict state only for selected WAV fields. Extend this pattern to all decision-critical dimensions.
- `NmeaDealer.qapCertified` and `distanceMiles` should be prominent when nearby dealer data exists (`types.ts:162-172`).
- Safety freshness and rating data exist but remain isolated in a tab instead of a concise hero warning when recalls are open.

## 5. Concrete design direction

- **Type:** 1.5rem vehicle title; 2rem price; 1rem body; 0.875rem supporting; 0.75rem eyebrow. Avoid sub-12px text.
- **Spacing:** 4px base rhythm; 16px mobile page padding; 24px section gaps; 32px desktop gaps.
- **Colour:** solid warm-neutral background, white surfaces, charcoal text, one orange primary, semantic green/amber/red only for status. Use semantic tokens from `docs/BRAND.md`; remove ad hoc rgba and hex.
- **Card anatomy:** image; price and freshness; title; mileage/location; WAV summary; source/dealer. Equal-height cards, no overlay data.
- **Gallery:** 4:3 or 3:2 image, visible count, thumbnails, labeled evidence chips, full-screen viewer, “No photo” state.
- **Mobile detail:** sticky bottom bar with `Contact seller` primary, `View original` secondary, and `Save`; hero contains price, location, freshness, and WAV fit summary.
- **Delete:** decorative charts from the first-run shopping path, nested glass cards, radial gradients, image hover zoom, unexplained tabs, and any control that makes users hunt for seller contact.

