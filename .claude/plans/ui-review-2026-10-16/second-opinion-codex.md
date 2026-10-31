The site looks unfinished because it gives secondary information primary space. Well-made shopping interfaces establish a clear sequence: **see vehicles → compare suitability → inspect evidence → contact seller**. WivWav currently makes shoppers interpret dashboards and discover hidden panels.

Read-only review of all nine screenshots and relevant source. Data coverage figures below come from `CONTEXT.md`; I did not remeasure production or run an accessibility audit. Paths below are relative to `apps/web/src/`.

**The 10 most damaging problems, ranked**

1. **Vehicles are buried beneath the filters. High · L**  
   `03-results-filtered-1440-tall.png` places cards roughly 1,800 pixels down. Home also opens with make/color statistics rather than inventory. This directly conflicts with BRAND.md’s search-and-comparison priority. **Fix:** compact filters across the top, then result count, sort, active chips, and vehicles. Collapse applied filters into a summary. Put distribution charts behind an optional “Explore inventory” control.

2. **Mobile pages visibly overflow. High · M**  
   `06-results-390.png` clips the heading, map, and language control; `09-discover-390.png` clips facet counts and the browse link. The header uses a nonwrapping tagline (`components/SiteHeader.module.css:56`); Discover’s grid uses `1fr` without explicitly removing intrinsic minimums (`discover/DiscoverPage.module.css:25`). **Fix:** constrain grid/flex children with `min-width: 0`, use `minmax(0, 1fr)`, wrap controls, simplify the mobile header, and constrain charts/maps. Verify the entire page at 320–430 pixels; hiding overflow is insufficient.

3. **Mobile vehicle detail conceals the shopping workflow. High · L**  
   `05-vehicle-390.png` shows a cropped vehicle, substantial blank space, and tabs near the bottom—no useful fit summary or seller action. `ListingSheet.tsx:12` starts at `peek`; `page.module.css:2` fixes the whole page to the viewport. **Fix:** normal document scrolling: bounded gallery, title/price, wheelchair suitability, seller. Keep a persistent bottom action bar. Remove the sheet as the primary content container.

4. **Wheelchair suitability is subordinate to ordinary car specifications. High · M**  
   Overview defaults first (`ListingSheet.tsx:20`), while conversion information lives in `WavTab.tsx:32`. Unknown ramp values disappear (`WavDetailsGrid.tsx:91`); an empty grid disappears entirely at line 137. **Fix:** put entry, ramp/lift, conversion manufacturer, and conversion status immediately beneath price. Explicitly show “Ramp type not provided.” Missing information is a shopping constraint, not an empty layout opportunity.

5. **Image presentation undermines trust. High · M**  
   The tall results screenshot shows broken images and repeated illustrative vehicle photos. Cards handle absent URLs but have no image-error fallback (`filters/page.tsx:178`). Detail navigation exposes seven windowed dots for 38 images, without an obvious total in the default screenshot. **Fix:** recover from failed images, identify stock/illustrative photos, display “1 of 38,” expose thumbnails and full-screen viewing, and prioritize actual ramp/interior photographs. Seven dots do not mean only seven images exist.

6. **The interface uses a blanket lavender treatment instead of hierarchy. Med · M**  
   `01-home-1440.png` gives almost every group its own tinted rounded container. Meanwhile detail specifications shrink to 11 pixels (`listings/[id]/tabs.module.css:109`). Hard-coded violet tokens remain in `app/globals.css:5`; detail adds hard-coded lavender gradients (`page.module.css:8`). **Fix:** neutral page, clear surfaces, readable text, restrained semantic color, section dividers, and cards primarily for vehicles/tools. Follow BRAND.md’s token system.

7. **Filters and data displays tell inconsistent stories. High · M**  
   The filtered screenshot shows Chevrolet/Chevy separately and unrelated models such as Grand Caravan. Model counts intentionally omit their own selection (`CategoryBarChart.tsx:31`), but nothing explains that scope. More seriously, `trim` appears in facets but is absent from the listing request forwarding list (`filters/page.tsx:65`), although the API supports it. **Fix:** forward trim, normalize make aliases, identify selected values clearly, and distinguish “matching vehicles” from alternatives available after changing a filter.

8. **Mileage formatting is visibly broken and the scale is unhelpful. Med · S**  
   Screenshots show `696kk+ mi`. `MileageHistogram.tsx:37` adds `k`; line 181 adds another for the accessible label. The maximum follows the largest bucket at line 116. **Fix:** one locale-aware formatter, visible units, editable numeric bounds, and a useful scale with an explicit overflow bucket that preserves outliers.

9. **Freshness language overstates certainty and risk. High · S**  
   A 42-hour-old listing receives “may no longer be available.” The stale threshold is just 12 hours (`verificationUtils.ts:5`), based on scrape timestamps. **Fix:** say “Last checked…” and reserve stronger warnings for meaningful evidence or a source-specific stale interval. “Verified” should identify what was verified. Move reporting below the main decision content.

10. **Financial and seller presentation lacks discipline. High · S**  
    `$1,189/mo` hides assumptions: 20% down, 6.5% annual interest, 60 months (`utils.ts:17`). “Also available at” repeats the same seller/price in `04-vehicle-1440.png`; cross-listings render without presentation-level deduplication (`OverviewTab.tsx:243`). **Fix:** disclose payment assumptions inline or remove the estimate; consolidate equivalent seller offers and suppress the alternate-seller section when nothing differs.

**What wheelchair-accessible-vehicle shoppers need**

**Cards:** actual/illustrative photo status and image count; title; prominent price; visible mileage unit; location; conversion manufacturer; side/rear entry; ramp/lift type; explicit unknowns; seller identity; last checked. Current cards omit conversion manufacturer from their local data type (`filters/page.tsx:19`) and hide the mileage unit visually at line 213.

**Detail:** an immediately visible suitability summary; doorway clearance, usable interior height, ramp width and capacity, wheelchair positions, passenger seating, securement/docking, transfer seat, hand controls, powered/manual equipment, conversion completion status, and conversion warranty/service evidence. These are information requirements—not claims that those measurements already exist in the database. Include a seller-question checklist when details are unavailable. Separate model-level conversion specifications from confirmed equipment on this individual vehicle.

**Icons**

- `TrendingUp` means fuel in `OverviewTab.tsx:167`: misleading. Use `Fuel`.
- Eleven-pixel specification icons are visual grit. Use consistent 18–20-pixel Lucide icons.
- Keep icon-only back, gallery arrows, copy, and reporting controls with accessible names and generous targets.
- Retain words for ambiguous concepts: entry configuration, conversion status, safety, and specialist equipment.
- Grey fallback swatches misrepresent Burgundy and OEM colors (`SwatchesRenderer.tsx:36`). Normalize to verified color families; use a distinct unknown treatment.
- VIN’s footer symbols are cryptic (`07-vin-1440.png`). Label them. Keep the VIN page’s useful distinction between model safety data and vehicle-specific facts.

**Data the interface wastes or misrepresents**

The supplied coverage figures show conversion manufacturer at 57%, yet cards omit it. VIN is 95% populated; make copying/opening its safety lookup straightforward. Coordinates exist for 73%; offer distance when a shopper provides location.

Conversely, ramp type is 96% unknown, wheelchair capacity only 2% populated, and floor-lowering measurements 0%. Styling cannot repair that gap. Preserve unknown/conflicting states and provenance; never infer absence of equipment from absence of data. Normalize raw engine strings, make aliases, casing, and trim before presenting them.

**Concrete direction**

Use one readable sans family: 16-pixel body, 14-pixel secondary text, 18-pixel card titles, 28–32-pixel page titles, 32-pixel detail price. Use a 4/8-pixel spacing rhythm, 16-pixel mobile gutters, 24-pixel desktop gaps, and 32–48 pixels between sections.

Give cards a consistent 4:3 image, price below the image, two-line title, mileage/location row, then two critical accessibility facts. Detail gets a bounded gallery with thumbnails and a visible count. Mobile gets a safe-area-aware sticky bar: price, **View seller listing**, and **Call** when available.

Delete the default facet wall, redundant seller block, empty gallery acreage, unexplained payment estimate, repetitive fuel/engine chips, and “personalized matches” copy unsupported by anything beyond an ordinary filter. The Next.js issue badge is a development artifact, not a product-design defect.