# Discover page design — WivWav

## Designer AI prompt

Read this entire `design.md` first. Then create one strong, unique mobile-first design direction for WivWav's Discover page.

The most important part is the facet layout. Do not design a generic marketplace sidebar, a plain filter drawer, or a long checklist. The Discover page should be recognizable from its filtering experience alone. Treat facets as the core product interaction: a practical way for shoppers to narrow wheelchair-accessible vehicle listings by mobility needs, vehicle basics, location, price, and seller context.

Create a polished design concept that shows:

- Mobile-first layout and desktop adaptation.
- How primary facets are visible without overwhelming the listing feed.
- How secondary facets open, collapse, and apply.
- How active filters appear, combine, and clear.
- How result counts, facet counts, disabled options, and no-results states behave.
- How accessibility-specific vehicle attributes feel first-class, not bolted onto a normal car marketplace.
- A distinctive visual concept: color, typography, spacing, iconography, motion, and component styling should make the page feel ownable to WivWav.
- A creative facet presentation that could become a recognizable product signature, while still being practical and accessible.

Avoid marketing hero sections, decorative cards, oversized empty space, generic ecommerce filter sidebars, and designs where accessibility features are hidden behind a vague "Filters" button. The page should feel calm, trustworthy, dense enough for repeated use, visually distinctive, and purpose-built for wheelchair-accessible vehicle search.

Output a detailed design proposal with annotated layout, component behavior, interaction states, mobile and desktop behavior, color direction, creative rationale, and any open questions for product/engineering.

---

## Goal

Design a Discover page that helps shoppers find wheelchair-accessible vehicles by making the right narrowing choices obvious, fast, and confidence-building.

The page should answer three questions at a glance:

- What vehicles are available?
- What can I narrow by?
- What is currently narrowing my results?

The facet system is the main design problem. Listings matter, but the page should not feel like a generic list with filters attached. It should feel like a purpose-built search surface for WAV shopping.

## Users

Primary users are shoppers, caregivers, family members, and operators who need to compare wheelchair-accessible vehicles. They may not know the exact vehicle they need yet, but they often know practical constraints:

- Side-entry vs. rear-entry access.
- Ramp vs. lift.
- Wheelchair seating capacity.
- Transfer seat, hand controls, lowered floor, or other mobility equipment.
- Budget, mileage, location, and condition.
- Dealer vs. private seller.

Many users will browse on mobile. The design must support real comparison and filtering workflows on a phone, not just shrink a desktop layout.

## Design Principles

- **WAV needs first.** Mobility and conversion facets should appear before generic vehicle shopping filters.
- **Visible filtering system.** Mobile users should see useful facet controls without first opening a hidden drawer.
- **Progressive disclosure.** Show high-value filters immediately; tuck advanced refinements into a structured panel.
- **Calm density.** The page can be information-dense, but grouping, spacing, and labels must keep it scannable.
- **Plain language.** Use terms shoppers understand. Avoid internal names when a clearer user-facing label exists.
- **Accessible by default.** Controls need clear labels, visible focus states, large tap targets, and non-color-only state indicators.
- **Map is optional context.** Listing location must remain usable without a map.

## Facet Model

### Primary facet groups

These should be visible near the top of the Discover page on mobile and desktop.

| Group | Purpose | Example controls |
|---|---|---|
| Mobility needs | Match the user's access requirements | Side-entry, rear-entry, ramp, lift, transfer seat, hand controls, wheelchair capacity |
| Location | Limit travel/shipping range | ZIP/city, distance radius, state |
| Budget | Establish affordability | Price range, monthly estimate if available |
| Vehicle basics | Narrow common vehicle traits | Make, model, year, mileage, condition |

### Secondary facet groups

These can live in an expandable sheet/panel, but should still be easy to find.

| Group | Purpose | Example controls |
|---|---|---|
| Conversion details | More precise WAV configuration | Conversion brand, ramp type, floor lowering, kneeling system |
| Seller/source | Trust and availability context | Dealer, private seller, source, days listed |
| Vehicle attributes | Standard automotive refinements | Fuel type, color, trim |
| Listing quality | Confidence filters | Has photos, has VIN, recently updated, price drop |

## Recommended Layout Direction

Use a two-layer facet system:

1. **Facet belt:** A compact, always-visible row/stack of high-priority controls above the results.
2. **Facet cockpit:** A structured bottom sheet on mobile and side panel/popover on desktop for full refinement.

### Mobile layout

The mobile page should be arranged as:

1. Header with WivWav identity, search field, and saved/search actions if present.
2. Result summary row: count, sort, and a compact "Refine" control.
3. Facet belt with primary facets:
   - Mobility needs as chips or segmented pills.
   - Location and price as compact summary buttons.
   - Vehicle basics as horizontally scrollable grouped chips.
4. Active filter strip, shown only when filters are active.
5. Listing feed.
6. Sticky bottom "Refine" affordance only when useful, showing active count and result count.

The mobile filter sheet should open as a bottom sheet with sections in this order:

1. Mobility needs.
2. Location.
3. Budget.
4. Vehicle basics.
5. Conversion details.
6. Seller/source.
7. Listing quality.

The sheet footer should include:

- Clear all.
- Show results count.
- Apply or close action.

## Creative Direction

The Discover page should be practical, but it should not be visually anonymous. The facet system is a chance to create a WivWav-specific interface language.

Explore one cohesive creative direction rather than several generic options. The design should feel like it belongs to a focused mobility-search product, not a normal car marketplace with accessibility filters added afterward.

### Visual metaphor

Use a subtle "route planning" or "fit finding" metaphor:

- Facets are waypoints in a shopper's path to the right vehicle.
- Active filters form a visible route or trail through the result set.
- Mobility needs are the first waypoint, not an advanced filter.
- Listings feel like matched candidates, not commodity tiles.

This metaphor should stay structural and UI-driven. Do not add decorative maps, fake roads, or illustrative clutter.

### Facet belt styling

The facet belt should be the most distinctive UI element.

Possible treatments:

- Grouped pill clusters with small icons and count badges.
- A segmented "Mobility first" control that gives entry/ramp/lift options more weight than generic filters.
- Active filters connected by a thin progress-line or route-line motif.
- Compact summary tiles for location and price that expand into richer controls.
- A sticky top surface that feels like an instrument panel, not an ad banner.

The design can be creative, but every control must still look clickable, readable, and familiar enough for repeated use.

### Motion

Use motion sparingly:

- Facet sheet slides up from the bottom on mobile.
- Active filter chips can gently compress into the active filter strip.
- Result count updates can use a short numeric fade.
- Avoid playful or bouncy motion; this is a trust-oriented shopping tool.

## Color Direction

Use WivWav's semantic token system from `docs/BRAND.md`, but give the designer a clear visual target.

The Discover page should use:

- A neutral page foundation using Slate-like background, surfaces, borders, and text.
- One primary seasonal/action color for interactive controls.
- One restrained accent color for secondary highlights.
- Fixed status colors for warnings, errors, success, and info.
- Actual vehicle color swatches only for the vehicle color facet.

### Recommended palette feel

Aim for a "calm navigation console" feel:

| Role | Suggested feel | Usage |
|---|---|---|
| Page background | Soft off-white or very pale slate | Overall page foundation |
| Surface | White or near-white | Listing cards, facet surfaces, sheets |
| Border | Cool slate gray | Grouping, dividers, inactive controls |
| Primary | Teal, jade, or warm orange depending on season token | Active controls, primary actions, selected filters |
| Accent | Sky, grass, or amber depending on season token | Count badges, subtle highlights, secondary emphasis |
| WAV feature signal | Green-family semantic treatment where appropriate | Positive mobility feature indicators |
| Warning | Amber | No-results suggestions, cautionary states |

Do not hard-code hex colors in the design spec. Reference semantic roles instead, but describe the intended mood and contrast.

### Color behavior for facets

- Inactive facet chips should be quiet: neutral surface, clear border, readable text.
- Active facet chips should use primary color treatment plus an icon/check/remove affordance.
- Mobility-related active filters may use a stronger feature-positive treatment, but must not conflict with status colors.
- Disabled facet options should be visibly unavailable through opacity, icon, label text, and count behavior, not color alone.
- Counts should be small and secondary; they should not visually compete with the facet label.

### Things to avoid

- A page dominated by one color family.
- Purple/blue SaaS gradients.
- Cream/beige marketplace warmth that feels generic.
- Dark dashboard styling.
- Decorative color blobs or ornamental backgrounds.
- Low-contrast pastel chips.

## Typography And Iconography

Typography should support scanning:

- Compact, legible headings.
- Clear label hierarchy inside facet groups.
- Listing metadata should be easy to compare across cards.
- Avoid oversized hero type on Discover.

Iconography should be functional:

- Use icons to distinguish mobility, location, price, vehicle basics, and more filters.
- Icons should support labels, not replace them.
- Avoid custom symbolic systems that users must learn before filtering.

Suggested icon meanings:

| Concept | Icon direction |
|---|---|
| Mobility needs | Accessibility, route, or vehicle-entry symbol |
| Location | Map pin or radius |
| Budget | Dollar sign or slider |
| Vehicle basics | Car/front view |
| More filters | Sliders |
| Active filter removal | X/close |
| Result count change | Small badge or counter |

### Desktop layout

Desktop should not simply become a generic sidebar. Keep the facet belt above results so the search model remains recognizable.

Recommended desktop structure:

- Top search and result summary.
- Horizontal facet belt with primary groups.
- Results area below.
- Optional right-side or left-side refinement panel for expanded secondary facets.
- Map/list split is acceptable only if list remains primary and all locations are available non-visually.

## Facet Belt Behavior

The facet belt is the signature interaction area.

It should:

- Show high-priority groups as labeled clusters, not unrelated chips.
- Allow one-tap selection for common needs.
- Display current values inline.
- Indicate when more options exist.
- Avoid layout shift when counts or labels change.

Example cluster labels:

- `Mobility`
- `Near`
- `Price`
- `Vehicle`
- `More`

Example chip labels:

- `Side-entry`
- `Rear-entry`
- `Ramp`
- `Lift`
- `Transfer seat`
- `Under $60k`
- `Within 250 mi`
- `Used`

Active chips should have a clear selected state with text and icon treatment, not color alone. Each active chip should be removable from the active filter strip.

## Active Filter States

Active filters must be obvious.

Required behavior:

- Show active filters in a strip below the facet belt.
- Each active filter has a remove action.
- Grouped filters should be summarized when there are many, e.g. `Mobility: 3 selected`.
- Include `Clear all` when two or more filters are active.
- Result count should update near the active filters.
- If a filter causes no results, preserve the user's choices and offer clear recovery actions.

## Empty And No-results States

No-results state should help the user recover, not just say nothing matched.

Include:

- Plain-language summary of the active constraints.
- Suggested filters to relax first.
- A clear all action.
- Option to save the search if that exists in product scope.

Example copy:

> No side-entry ramp vans under $40k within 100 miles right now.
> Try expanding distance, raising price, or including rear-entry vans.

## Listing Cards

Listing cards should support quick comparison.

Show:

- Photo.
- Price.
- Year, make, model.
- Location.
- Mileage.
- Condition.
- Key WAV features: entry type, ramp/lift, wheelchair capacity, transfer seat/hand controls when present.
- Seller/source.

Do not bury WAV traits under generic car metadata. Accessibility-related details should be as prominent as price and mileage.

## Sort And Result Summary

Sort should be compact and predictable.

Recommended options:

- Best match.
- Newest.
- Price low to high.
- Price high to low.
- Mileage low to high.
- Nearest.

Result count should appear near the facet belt and update with filters.

## Accessibility Requirements

- Minimum touch target: 44px, preferably 48px for primary controls.
- Keyboard focus must be visible.
- All filter controls need programmatic labels.
- Filter sheets/panels need correct modal semantics and focus management.
- Active filter remove buttons need descriptive labels, e.g. `Remove side-entry filter`.
- Disabled facet options must include text/state, not color only.
- Counts should not be the only indicator of availability.
- Map must not be required to understand location results.

## Visual Direction

Use the WivWav brand direction from `docs/BRAND.md`:

- Clear, trustworthy, fast, calm.
- Restrained, high-contrast UI.
- Functional layout over decorative sections.
- Data density is good when scannable.
- Cards only for repeated listings, modals, and framed tools.

Avoid:

- Marketing hero sections.
- Decorative gradients or background ornaments.
- A one-note color palette.
- Nested cards.
- Generic ecommerce sidebar filters.
- Hiding all facets behind a single "Filters" button.

## Open Questions

- Which mobility facets are mandatory for launch vs. later refinement?
- Should result counts update live as each filter changes, or only after applying the sheet?
- Should the page support saved searches at launch?
- Should distance use ZIP input, browser location, state, or all three?
- Are facet counts available for every filter from the API, or only selected fields?
- Which filters should be indexed as first-class Meilisearch facets beyond the current search API fields?
