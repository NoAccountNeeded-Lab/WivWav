---
name: wav-data-display
description: Interpret WivWav operations or analytics data and choose, build and verify the display for it (table, chart, tile, Recharts view) when adding or reworking a dashboard, queue, run-history or count display. Use before writing chart code, or when a table or chart is hard to read or shows data with no clear purpose.
---

# Choosing and building a data display

Goal: every display answers "what action does this help someone take?". Work from that question to the data, then to the form. Write the code, not just a critique.

## 1. Fix the question and the evidence first

- Name the reader, the decision, and the action the display should make easier. If you cannot, cut the display or fold it into a number or sentence.
- For each measure, write down: what is counted (grain), unit, window or as-of time, source (endpoint/field), and how it fails (null, stale, partial, truncated page). Read the actual API type and route handler, not a UI label.
- Separate states that look alike but call for different actions (for example waiting, running, delayed; completed, recovered). Never merge them to get a bigger bar, and never infer a cause (stuck, scheduled, retry, healthy) that no field states. If a field that would settle it is missing, say what is unknown.
- History exists only if the API returns it. Do not synthesize series, rates, durations or trends from a single snapshot. State the window, the cap, what is missing, and that nothing older is shown.

## 2. Choose the form

- Match the task: ranking or comparing magnitude, composition, change over time, outcome by group, or one headline number. A single value is a stat tile, not a chart; many unrelated categories with exact values are a table.
- Default to one view. Add an alternate only when it answers a different question over equivalent observations (same data, window and filters, with totals that reconcile, tested). Two views of the same question are clutter. A switcher beats stacked charts.
- Rank and trim to what drives action (largest, failing, anomalous) and say what was left out and where it is. Do not let many identical small items dominate.
- Long exact tables go behind a collapsed, readable details control, not under the chart by default.
- No pie or donut for unrelated or close-valued observations; no dual axes; no colour as the only signal.

## 3. Build it in this repo

- Reuse `packages/charts` before adding a component; new shared components stay generic (rows, series, labels). Meaning, labels and copy belong in the app. Charts package builds with `tsc` and apps consume `dist`, so run `pnpm --filter @wivwav/charts build` before app tests or E2E.
- Read the installed library's types and docs under `node_modules` (version-specific; check which package actually resolves it) instead of recalling examples. Confirm keyboard/focus behaviour in a real browser, not jsdom.
- Colour from the app's tokens (ops: `--clr-*`; web: `docs/BRAND.md` semantic tokens), never raw hex. Run the `dataviz` skill validator on any pair of series colours against the real surface in a dark and a light theme; red vs green fails colour-vision separation, so do not make success green just because it is a status.
- Put exact values in text beside the mark (label, summary sentence, tooltip, details table) so the display reads without hover, colour or a pointer.
- Give every display visible empty, unavailable (unknown, never zero), stale (last good reading, marked) and loading states. Label units, as-of time and window in the display itself.
- Keep API-first boundaries: use existing endpoints. A new endpoint or persisted snapshot needs a stated decision that no existing one can answer it, plus `docs/api-routes.md` and authentication.

## 4. Verify

- Unit-test the data model (ranking, trimming, reconciliation between views, null vs zero, partial data). Test text and tables, not SVG internals.
- In a browser: chart has real size at desktop and phone width, no page-level horizontal overflow, view choice survives a data refresh, collapsed details are not focusable until opened, wide tables scroll inside a focusable named region, and an axe A/AA scan is clean.
- Record gaps you could not test (manual screen reader, live data) instead of calling the work complete.

Worked example (queue waiting vs running vs delayed, per-source scrape outcomes, and why no queue history is drawn): `docs/ops/helm-data-display.md`. It illustrates the reasoning; it is not a policy to copy for other data.
