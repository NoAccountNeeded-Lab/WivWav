# Homepage, Discover, and results redesign

Status: in progress; production baseline and combined design preview are recorded, while product implementation has not started.

## Goal and decisions

Create a sharp, informative, accessible shopping journey:

**Homepage → Discover → Results → Vehicle**

- Lead the homepage with inventory insights and practical shopping guidance. Track sourced research and daily content rotation as later work.
- Use deep purple for actions/selections, muted teal shades for unselected charts, and neutral surfaces across public shopping pages.
- Use separate Discover and results pages with normal navigation, releasing the chart-heavy interface before displaying results. Measure memory rather than assuming routes alone solve it.
- Display four facets across and four result cards across at the actual laptop viewport. Adapt to smaller screens.
- Include every current facet and add wheelchair capacity, transmission, city, and conversion status.
- Prototype alternative result views first; ship the standard grid as the production default.
- Add a compact results insights/control panel using the complete matching set, not just the current page of cards.

The results panel direction is a recommended first implementation based on the follow-up discussion; its visual composition should be included in the initial design preview.

## Tasks and progress

Use this table as the local progress view. GitHub parent #1231 and linked implementation issues #1232–#1239 are the task-status source; keep this document's milestone summaries and links aligned with them.

| ID | Task | Depends on | Status | Issue / preview / PR | Acceptance evidence / blocker |
| --- | --- | --- | --- | --- | --- |
| 1 | Establish data, design, and performance baseline | — | Needs review | [#1232](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1232) · [parent #1231](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1231) · [combined preview](home-discover-results-redesign-preview.html) | Three desktop route cycles measured with Chromium 153.0.8010.12: approximate heap 15.2 MB at all seven samples; Discover/results 5/4 facet calls, 580/1,216 DOM elements; result images loaded 16/20 on the first capture and 19/20 later. Durable script, JSON samples, and four desktop/mobile screenshots are in [baseline captures](baseline-captures-2026-10-30/); see the [integrated preview](home-discover-results-redesign-preview.html). A separate exploratory run read 11.2 MB; these rounded Chromium values vary between runs. Field-coverage unknowns remain explicit in #1232 and are reserved for #1233. |
| 2 | Update visual foundation and shared facet frame | 1, 3 | Ready | [#1234](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1234) | Blocked by #1232 and #1233, matching the linked issue dependency |
| 3 | Extend search with the four new filters | 1 | Ready | [#1233](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1233); existing requests [#583](https://github.com/NoAccountNeeded-Lab/WivWav/issues/583), [#585](https://github.com/NoAccountNeeded-Lab/WivWav/issues/585), [#586](https://github.com/NoAccountNeeded-Lab/WivWav/issues/586), [#587](https://github.com/NoAccountNeeded-Lab/WivWav/issues/587) | Existing filter AC reconciled under #1233 |
| 4 | Rebuild the complete Discover grid and state map | 2, 3 | Ready | [#1234](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1234) | Includes responsive grid and text location alternative |
| 5 | Polish colors, donuts, bars, tooltips, and collapse | 2, 4 | Ready | [#1234](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1234) | Accessibility and reduced-motion evidence required |
| 6 | Fix slider jumping | 1 | Ready | [#1235](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1235) | Delayed navigation reproduction required |
| 7 | Separate results and implement four-card layout | 2, 3 | Ready | [#1236](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1236) | Bounded pagination and lazy images |
| 8 | Add results insights and compact controls | 3, 7 | Ready | [#1236](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1236) | Aggregates and suggestions use full matching set |
| 9 | Build inventory-led homepage | 1, 2 | Ready | [#1237](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1237) | Timestamped cached aggregates; unavailable states stay honest |
| 10 | Preview album flow and wildcard result views | 2 | Ready | [#1238](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1238) | Preview only; standard grid remains production default |
| 11 | Verify complete journey and prepare release | 4–9 | Ready | [#1239](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1239) | Evidence and rollout/rollback notes required |

Use existing ready, in-progress, needs-review, and stuck labels. Record blockers explicitly and distinguish reviewed, merged, and deployed work. Issue #1107 remains open to track its existing UI bugs; filter issues #583, #585, #586, and #587 are linked under #1233 with reconciled acceptance criteria.

### 1. Baseline and design preview

- Record the actual laptop CSS viewport; capture homepage, Discover, and results at that width and on mobile.
- Audit current eligible inventory, missing-field coverage, conversion-brand catalog coverage, price validity, and available aggregate APIs. Historical audit numbers are not current evidence.
- Trace URL state, query forwarding, facet counts, search eligibility/deduplication, and request ownership before edits.
- Measure current requests, loaded images, and memory over repeated Discover/results round trips using the retained [measurement script](../../e2e/scripts/measure-redesign-baseline.mjs); inspect [raw samples and screenshot manifest](baseline-captures-2026-10-30/measurement.json).
- Preview the homepage, four-column facets, results panel, and four-card grid together before detailed styling.
- Resolve the brand guide's missing `dataviz` reference before chart implementation. Update the canonical brand guidance rather than introducing a competing design authority.

### 2. Visual foundation

- Update semantic tokens and `docs/BRAND.md` for fixed purple/teal public shopping styles. Retire public seasonal controls and safely ignore obsolete stored seasonal preferences; preserve unrelated ops behavior.
- Give every facet except the Location/States map the same border, radius, heading treatment, and spacing.
- Use existing icons with text labels where helpful; do not replace meaningful labels with icons alone.
- Keep interactive dimensions stable through hover, focus, selection, loading, and count changes.
- Test a subtle, slow teal variation in a restrained decorative region only. Never animate chart meaning, selection colors, or text contrast. Pause hidden tabs, honor reduced motion, and omit the effect if it adds meaningful rendering cost or distracts.

### 3. Search and new filters

- Extend existing listings/facets validation, shared types, search document mapping, filterable settings, filter builders, aggregation, query forwarding, URL helpers, active chips, and histogram forwarding together.
- Capacity uses exact positive counts. Missing capacity remains distinct from zero; reject malformed, negative, fractional, and out-of-range query values.
- Conversion status retains existing meanings: proposed, complete, unknown. Do not relabel it converted/unconverted.
- City selections identify city/state pairs, preventing same-name cities or multiple selected pairs from producing cross-product matches. Explicit state restrictions still apply; conflicting selected cities remain visible and removable.
- Normalize transmission deterministically while preserving raw source values.
- Preserve existing OR-within-facet and AND-between-facet behavior and disjunctive counts.
- Rebuild and swap the search index using the existing process, verify completion, and invalidate affected facet caches before exposing the new controls. Retain the established rollback path.
- Preserve old URLs and document additive API changes. No database migration is assumed necessary for these existing listing fields.
- Preserve the current fail-closed search outage behavior: return the documented unavailable state rather than introducing an unfiltered database fallback.

### 4. Discover grid and location

- Use one categorical-data owner instead of separate fetching components per column. Deduplicate shared requests and cancel obsolete requests.
- Use four equal columns at laptop width, three at intermediate widths, two on tablets, and one on phones, with meaningful DOM and keyboard order.
- Represent make, model, trim, condition, entry type, conversion brand, colors, states, seller type, fuel, WAV equipment/ramp types, price, year, mileage, wheelchair capacity, transmission, city, and conversion status.
- Prioritize mobility requirements in reading order. Keep facet headings visible when data is unavailable; preserve selected zero-count options so users can remove them.
- Use one borderless Location/States facet with the US map, including Alaska and Hawaii. Provide an equivalent text selector covering small states, DC, and supported locations; do not duplicate state-bar and map facets.

### 5. Facet interactions

- Colors: extend shared normalization into a compact family list, retain raw source colors, show common families first, and expose remaining families through “More colors.” Preserve existing color links. Use reserved space plus an inset ring/checkmark so selection never grows or crowds labels.
- Tooltips: replace native facet title tooltips with one styled treatment. Target approximately 150 ms hover delay and immediate keyboard-focus display; support dismissal and touch access. Essential information stays available without tooltips.
- Donuts: make slices and direct labels selectable. Remove the separate legend only after equivalent accessible controls exist. Hover/focus slightly offsets a slice; each selected slice stays offset with stronger purple treatment. Support multi-selection, tiny slices, keyboard activation, visible focus, touch, and selected zero-count values.
- Bars: use teal for unselected data and darker purple for selected data, with a non-color selection indicator. Apply consistently to categorical charts and range histograms.
- Collapse: each facet heading is a button with expanded state and chevron. Use a brief, subtle anticipatory movement before collapse/expansion. Preserve selections and show their summary while collapsed; disable motion for reduced-motion users.
- Chips: match Clear All to other chips in height, typography, padding, and alignment.

### 6. Slider correction

- Reproduce price, year, and mileage jumping with delayed navigation before choosing the fix.
- Leading hypothesis: the histogram components clear local drag state before asynchronous URL navigation settles. These controls use the web slider wrapper, not the separate shared chart RangeSlider.
- Keep displayed values stable until the committed URL acknowledges the change. Ensure stale navigation or responses cannot overwrite a newer edit.
- Cover rapid successive edits, Back/Forward, keyboard and touch input, changing bounds, endpoints, invalid URL values, and empty datasets.

### 7. Results journey and cards

- Add a sticky “See N matches” action on Discover, using the live total and current query. Keep Browse all available.
- Navigate normally to results. Remove full facet mounting from the shared results renderer; retain active chips, sort, pagination, and Edit filters.
- Preserve direct links, locale, browser history, query state, and no-results recovery.
- Display four cards across at laptop width with responsive reductions on smaller screens.
- Use bounded pagination, appropriately sized thumbnails, and lazy-loaded images. Do not accumulate an ever-growing result collection.

### 8. Results insights/control panel

Place a compact “Your search at a glance” panel above the results grid. Keep cards prominent and avoid recreating the complete facet interface.

Initial content:

- **Your matches:** total, budget distribution, entry-type mix, leading conversion brands, and geographic coverage across the entire matching set.
- **Helpful context:** relevant conversion-company/catalog facts and plain-language entry/ramp explanations, shown when the data supports them. Load expanded brand details on demand.
- **Useful controls:** existing sort and Edit filters, plus up to three explicit suggestions to broaden the search, such as removing a state restriction or increasing a price bound by one existing budget bucket.

Behavior and data rules:

- Reuse the same normalized query and eligibility/deduplication policy as results. Aggregate over all matches independently of pagination and sorting.
- Show calculation time, known-data denominators, and unavailable states. Do not calculate population claims from the current card page.
- Reuse the facets endpoint for distributions. Use existing price buckets as labelled ranges rather than presenting an invented exact median.
- Evaluate suggestion counts with the exact proposed query. Show a small bounded set only when verified to add matches; never change constraints automatically. Suggestion links preserve unrelated filters and reset pagination.
- Keep currently selected mobility requirements intact in initial broadening suggestions; do not silently trade them away for more results.
- Distinguish conversion-company/product catalog specifications from confirmed features on individual vehicles. Do not infer compatibility, certification, quality, or safety from brand presence alone.
- Use lightweight server-rendered summaries and simple visuals. No polling, per-card enrichment fan-out, or continuously running chart animation. Abort obsolete requests and cache query-specific aggregates.
- Panel errors must not prevent available result cards from rendering. For zero matches, prioritize clear recovery actions over empty charts.

### 9. Homepage

Build these sections:

1. Compact explanation of WivWav with a prominent Find your vehicle action.
2. Inventory snapshot: available vehicles, geographic coverage, and known entry-type distribution.
3. Budget discovery links based on existing price buckets.
4. Short guidance explaining entry and access-equipment choices.
5. Repeated Discover action, with relevant preselected filters where appropriate.

Reuse the facets API and server-side caching. Add a calculation timestamp to its cached response and expose its total in the web facet model; distinguish calculation time from page-render time. Cache versioning must prevent old payloads from surviving the contract change.

Use the same eligibility, deduplication, and price-validity rules as search. Show missing-data coverage when it affects interpretation. Unavailable APIs must produce honest unavailable states, never fabricated zeros.

No new homepage database table or external research ingestion is required for this release. Track sourced recall explainers, conversion-company research, buying guides, and daily content rotation as linked backlog work. Model-level recalls must remain distinct from verified VIN/remedy status; missing safety data never means no recalls.

### 10. Alternative result previews

Use the same bounded vehicle sample for three standalone previews:

- Album flow: horizontal photo browsing with a clear vehicle summary.
- Comparison matrix: vehicles as columns and practical WAV attributes as rows.
- Fit-first spotlight: one large candidate with visible tradeoffs and a compact queue.

Evaluate scanability, keyboard/touch use, mobile layout, image/memory cost, and visibility of key WAV facts. Do not add production view-switching infrastructure until a direction is chosen separately.

### 11. Verification and release

- Verify homepage → prefiltered Discover → results → vehicle → return, including direct links and browser navigation.
- Cover every facet, combined filters, clearing, selected zero-count values, unavailable APIs, and no matches.
- Verify city/state pair identity, malformed input rejection, new index/filter contracts, disjunctive counts, old URL compatibility, query/chip round trips, and index rebuild completion.
- Verify insights against all matches across multiple result pages; test missing-data denominators, verified suggestion counts, exact suggestion URLs, brand catalog versus listing evidence, and panel-only failures.
- Test sliders under delayed navigation and rapid edits, including endpoints and changing bounds.
- Record keyboard, screen-reader semantics, focus, contrast, tooltip dismissal, touch targets, and reduced-motion evidence.
- Check four-column facets and cards at the actual laptop viewport and responsive layouts on smaller screens.
- Compare memory and requests over repeated Discover/results round trips. Check retained charts, listeners, requests, and image collections; record the method and measured results without claiming universal browser memory guarantees.
- Run focused tests during development, then repository-required typecheck, lint, build, tests, and built-container accessibility/E2E checks. Map each issue acceptance criterion to evidence.
- Record rollout order, rollback procedure, and post-release smoke checks. Follow the issue → branch → review → PR workflow; pushing, merging, and deployment remain separate actions governed by repository instructions.

## Review and limitations

A second in-account AI agent reviewed the initial plan and new-filter scope. Incorporated findings include single-owner facet fetching, the actual slider ownership layer, accessible donut replacement controls, a text map alternative, removal of facets from the shared results renderer, truthful homepage data, composite city identity, cache invalidation, and safe index rollout.

The results insights panel was added after that review and should receive an independent review with its implementation issue.

Planning inspection covered repository source, reconciled issues #1107 and #583/#585/#586/#587, and captured live snapshots at laptop width (1710×960 CSS px / DPR 2) and mobile width (390×844 CSS px / DPR 3). Discover and results totals differed moments apart (376 and 374); the current Discover CTA row visibly overflows at 390px while facets stack vertically. Three Discover→Results→Back cycles in Playwright Chromium 153.0.8010.12 produced seven page samples: approximate `performance.memory.usedJSHeapSize` read 15.2 MB in every sample; DOM element counts were 580 on Discover and 1,216 on Results; each Discover document made 5 facet requests and each Results document 4. An earlier exploratory run read 11.2 MB, so heap values vary between runs and are rounded by Chromium. Resource entries were 35/57 on first Discover/Results, then 36/58 on subsequent cycles. Results had 20 image elements; 16 were loaded on the first capture and 19 on later captures. This is a single repeatable run and point-in-time inventory, not proof of a universal absence of leaks. The repeatable script, JSON samples, and four viewport screenshots are retained in `e2e/scripts/measure-redesign-baseline.mjs` and `baseline-captures-2026-10-30/`. The production facets endpoint reports 376 eligible matches; 265 prices bucketed from $45k–$110k, 111 without price; state counts sum to 247; entry type counts sum to 376. The separate public brand catalog has 14 entries; listing facets show 3 brands totaling 351, leaving 25 listings without returned brand data and 11 catalog brands without a count in this snapshot. Current facets do not expose capacity, transmission, or city coverage, so their missing-field denominators remain unknown. Available aggregate APIs are `/v1/listings/facets` and `/v1/conversion-brands`; facet-service failure currently returns zeroed distributions. URL code preserves query state, but `trim` is missing from the current results forwarding list. Search indexing deduplicates by `vehicleGroupKey` among active, eligible listings. Local dependencies installed from cache, but the branch’s local UI could not load facet data from the API container owned by the separate #1226 worktree; local runtime accessibility remains to verify after implementation. No memory improvement or product behavior change has been claimed.

This slice records baseline evidence and the integrated design preview only; no product behavior, database change, push, merge, or deployment is included. Tracking issues #1231–#1239 were created. Baseline commits `a5db6c52`, `6ecc60e7`, `bfd9e81a`, and `ce923f8e` remain local on the #1232 branch.
