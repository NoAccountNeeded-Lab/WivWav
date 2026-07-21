# Spike: MUI Core + MUI X Community for `@wivwav/ui-web` (#852)

Status: spike complete — evidence gathered for maintainer sign-off per
`docs/design/ui-boundary-and-ops-workspace.md` section 6, item 1. This
document does not itself accept or reject MUI; it records what was measured
so the maintainer can decide.

**Recommendation: accept MUI Core + MUI X Community for `@wivwav/ui-web`**,
conditional on the follow-ups in section 8 (code-split the data grid; a real
screen-reader pass in #853; confirm Community-tier grid features actually
cover Ops' requirements before assuming them).

Throwaway prototype code backing this spike lives at
`spikes/852-mui-evaluation/` (`design-tokens/`, `ui-web/`, raw
`licenses-prod.txt` and `a11y-results.json`) and is **not** the foundation
package — that is built fresh in #853 per the issue's own scope ("prototype
... not the final foundation package").

## 1. License matrix

Pinned versions resolved by `pnpm install` against this spike's
`package.json` (`pnpm --filter @wivwav/spike-852-ui-web list ... --depth 0`):

| Package | Version | License |
|---|---|---|
| `@mui/material` | 9.2.0 | MIT |
| `@mui/system` | 9.2.0 | MIT |
| `@emotion/react` | 11.14.0 | MIT |
| `@emotion/styled` | 11.14.1 | MIT |
| `@mui/x-data-grid` | 9.10.0 | MIT (Community edition; confirmed via `pnpm view @mui/x-data-grid@9.10.0 license`) |

Full transitive **production** dependency license list captured via
`pnpm --filter @wivwav/spike-852-ui-web licenses list --prod` — 89 packages,
raw output archived at `spikes/852-mui-evaluation/licenses-prod.txt`.
Distinct licenses across all 89:

- **MIT** — the overwhelming majority, including all 5 named packages.
- **BSD-3-Clause** — `hoist-non-react-statics`, `react-transition-group`
  (used internally by MUI transitions), `source-map`.
- **ISC** — `picocolors`, `yaml` (build-tool transitives).

No GPL, AGPL, or other copyleft license appears anywhere in the tree. MIT
and BSD-3-Clause are already on `.claude/core.md`'s allowlist. **ISC is
not** — but this is not a new gap introduced by MUI: `lucide-react` (ISC) is
already a runtime dependency of both `apps/web` and `apps/ops` today, and
`docs/design/ui-boundary-and-ops-workspace.md` section 6 item 2 already
flags this as a root policy gap for the maintainer to resolve (add ISC to
the allowlist, or require a replacement). This spike does not change
`.claude/core.md` unilaterally, consistent with that existing decision.

`@mui/x-data-grid-pro` and `@mui/x-data-grid-premium` were never added to
any `package.json` in this spike or the workspace — verified by `grep -r
"x-data-grid-pro\|x-data-grid-premium" **/package.json` returning no matches
outside this document's own prose.

**No SBOM or automated license-notice tooling exists in this repository**
(confirmed — no `license-checker`, `cyclonedx`, or similar config anywhere
in the workspace). Per section 6 item 4 of the boundary doc, this spike
recommends **deferring** introduction of one specifically for MUI; the
`pnpm licenses list` output captured here and re-run at #853/#854 is
sufficient evidence for now. A workspace-wide SBOM process, if wanted,
should be scoped as its own issue rather than bootstrapped ad hoc here.

## 2. MUI X Data Grid Community vs. Pro/Premium features

Checked directly against MUI's own docs (mui.com/x/react-data-grid/*, July
2026) rather than assumed:

| Feature | Tier | Notes |
|---|---|---|
| Sorting, single-column filtering, pagination, row selection | **Community** | Baseline, no restriction. |
| Column groups (grouping columns under a shared header) | **Community** | Reordering *within* a group is Pro; the grouping itself is Community. |
| Print / CSV / clipboard export | **Community** | No badge on these in the docs. |
| Multi-column / advanced filter builder | **Pro** | "With the Data Grid Pro, users can apply multiple filters based on different criteria." |
| Column pinning | **Pro** | Explicit "[Pro plan]" badge on the docs page. |
| Server-side export | **Pro** | |
| Row grouping (grouping rows by repeated column values) | **Premium** | Not Pro — Premium only. |
| Excel export | **Premium** | Depends on `exceljs`; Premium-only. |

**Implication for the Ops/Web grid requirements named in the issue** (multi-
column filter, pinning, grouping, export): **three of the four are
Community-blocked.** Multi-column filter and pinning need Pro; row grouping
needs Premium. Only export (CSV/print/clipboard) is fully Community. Column
*grouping* (header grouping, not row grouping) is Community and could be
mistaken for satisfying the "grouping" requirement, but it is a different
feature from what "group these rows by source/status" implies for an Ops
grid.

**This is the single biggest fact for the maintainer's acceptance decision.**
If the Ops runs/sources/logs grids are expected to need column pinning,
multi-column filtering, or row grouping in their first real iteration, MUI
X Community does not cover that and the workspace-wide "Pro/Premium
forbidden" constraint (`.claude/core.md`, reinforced by the boundary doc)
means those features are simply unavailable, full stop, unless that
constraint itself is revisited. If those features are not near-term
requirements, Community is sufficient and this is not a blocker.

## 3. Prototype packages

Built at `spikes/852-mui-evaluation/`:

- `design-tokens/` (`@wivwav/spike-852-design-tokens`) — plain-data
  semantic tokens (color roles for light/dark, spacing scale, type scale,
  motion durations). No React, DOM, or CSS imports — satisfies the
  platform-neutrality rule in `docs/design/ui-boundary-and-ops-workspace.md`
  section 1. `tsc` builds clean under `.claude/core.md`'s strict TS
  settings (`strict`, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`).
- `ui-web/` (`@wivwav/spike-852-ui-web`) — `UiWebProvider` (theme +
  `CssBaseline`, built from the tokens above), `Button`/`IconButton`
  (thin policy wrappers — e.g. `IconButton` makes `aria-label` a required
  prop, not optional, tightening MUI's own looser type), and pass-through
  re-exports for `Menu`/`Dialog`/`Drawer`/`Tooltip` and a Community-only
  `DataGrid`. `tsc` builds clean.

Both `package.json`s carry an explicit `"description"` marking them as
throwaway spike prototypes, not the #853 foundation package, and the
workspace root's `pnpm-workspace.yaml` gained a `spikes/*/*` glob scoped to
this kind of throwaway work (comment explains why). Neither `apps/web` nor
`apps/ops` depends on either package in the committed state of this branch —
see section 5 for how the bundle numbers were actually measured without a
committed production dependency.

## 4. Storybook

`spikes/852-mui-evaluation/ui-web/.storybook/` configures Storybook 10
(`@storybook/react-vite` + `@storybook/addon-a11y`) with a `viewport`
addon exposing `narrow` (375px) and `wide` (1440px) presets, and the
`UiWebProvider` mounted as a global decorator.

Two representative story files, each covering multiple states and both
viewports:

- `src/stories/WebListingSurface.stories.tsx` — modeled on
  `apps/web/src/components/listing/SimilarListings.tsx` and the vehicle
  detail page's report-listing action (not a copy of production code).
  States: `Loading`, `ErrorState`, `Empty`, `Loaded` (+ `LoadedNarrow` /
  `LoadedWide`). Exercises `Tooltip`, `IconButton`, `Menu`, `Dialog`, and
  `DataGrid`.
- `src/stories/OpsRunDetailPanel.stories.tsx` — modeled on
  `apps/ops/src/components/Inspector/InspectorPanel.tsx` and
  `apps/ops/src/app/ops/runs/RunsClient.tsx`. States: `Loading`,
  `ErrorState`, `Running`, `Complete` (+ `RunningNarrow` / `RunningWide`).
  Exercises `Drawer`, `Menu`, `Tooltip`, and `DataGrid`, including a live
  "Running…" status text matching a real run's in-progress state.

`storybook build` (`npx storybook build`) completes successfully; static
output was used as the target for the accessibility probe in section 6 and
is not committed (`storybook-static/` is build output, regenerable via
`pnpm --filter @wivwav/spike-852-ui-web build-storybook`).

## 5. Bundle delta

**Method:** Next.js 16's Turbopack production build no longer prints the
classic per-route "First Load JS" table (confirmed with both `next build`
and `next build --webpack`). Route-level client JS was instead computed
directly from each route's `page_client-reference-manifest.js` (the
per-route RSC client-module manifest Next itself generates), resolving
every referenced chunk under `.next/static/chunks/` and summing raw +
gzip size. This is the same set of chunks the browser would actually
fetch for that route's initial load.

Representative routes, each measured **before** and **after** temporarily
adding a workspace dependency on `@wivwav/spike-852-ui-web` and wiring in
real usage, then fully reverted (`git checkout --`) — no MUI dependency is
present in the committed state of either app:

| Route | Component(s) added | Before (raw / gzip) | After (raw / gzip) | Delta |
|---|---|---|---|---|
| `apps/web` `/[locale]/vehicle/[id]` | `IconButton` + `Tooltip` (replacing the existing `BackButton`'s plain `<button>`) | 569.4 KB / 177.1 KB | 704.9 KB / 225.5 KB | **+135.5 KB raw (+23.8%), +48.4 KB gzip (+27.3%)** |
| `apps/ops` `/inspector-preview` | `DataGrid` (3-row demo grid added inside the existing inspector panel) | 99.7 KB / 28.0 KB | 798.6 KB / 235.3 KB | **+698.9 KB raw (+701%), +207.3 KB gzip (+740%)** |

**Reading these numbers:**

- The `apps/web` delta is the realistic floor cost of adopting MUI at all:
  even two of the lightest components (`IconButton`, `Tooltip`) pull in
  `@mui/material`'s core + `@emotion`'s runtime as a new ~63 KB-gzip chunk
  that any first MUI-using route pays once. Every subsequent MUI component
  used elsewhere shares that same chunk (this measurement doesn't show
  amortization since only one route was probed), so this is closer to a
  worst-case "first adopter tax" than a per-component cost.
- The `apps/ops` delta looks alarming (+740% gzip) but is **not** a fair
  reading of `DataGrid`'s intrinsic cost — the demo route imports it
  eagerly with no code-splitting boundary, so the entire grid (plus its own
  virtualizer) lands in the route's initial chunk. **This is the spike's
  clearest actionable finding: any real usage of `DataGrid` must be
  behind `next/dynamic(() => import(...), { ssr: false or loading })`** so
  it is not paid for on routes that don't render it and is deferred even on
  routes that do. #853 should treat this as a hard requirement, not an
  optimization to consider later.
- Both apps already ship Tailwind (`apps/web`) or CSS Modules (`apps/ops`)
  as their styling layer; `@emotion` runs as a second, separate CSS-in-JS
  engine alongside either. The measured delta already includes emotion's
  runtime cost — it is not an additional hidden cost on top of these
  numbers.

## 6. SSR / hydration (Next.js 16 / React 19, App Router)

Verified against `apps/ops`'s existing `/inspector-preview` route (chosen
because it is explicitly a DB-independent dev harness route, so it could be
built and served without standing up Postgres/the API):

- **Production build compiles clean** with `'use client'` MUI components
  embedded in an App Router page, under both `next build --webpack` and the
  Turbopack default, for both apps.
- **True SSR confirmed with JavaScript disabled**: fetching the route with
  `javaScriptEnabled: false` in a real browser (Playwright/Chromium) still
  returns the button's text content, MUI's `MuiButton-root` class, and an
  inline `<style data-emotion...>` tag containing the button's actual
  computed styles — i.e. Emotion's SSR style extraction works correctly
  under Next 16's App Router without any extra `createEmotionCache`
  plumbing, and there is no flash-of-unstyled-content.
- **No hydration-mismatch console warnings** ("Hydration failed",
  "Text content does not match", or similar) appeared when the same page
  was then loaded with JavaScript enabled and its console captured.
- **Inconclusive on live interactivity**: a scripted post-hydration click
  test (open a `Dialog` by clicking a button) did not observe the dialog
  open, in either the MUI button or — critically — a **pre-existing,
  non-MUI plain `<button>` already on the same page**. Since the
  non-MUI control failed identically, this points to an artifact of the ad
  hoc dev-server harness used for this probe (custom env vars injected
  inline, no HMR websocket available in this sandboxed environment — visible
  in the captured console as repeated `webpack-hmr` connection failures),
  **not a defect in MUI or in Next/React's hydration itself**. Recorded
  honestly as inconclusive rather than glossed over; re-running the same
  click-through check in a normal `pnpm dev` session (not this sandbox) is
  listed as a follow-up in section 8.

## 7. Accessibility

Automated, empirical checks against the built Storybook (`storybook build`
→ served statically → driven with Playwright + `axe-core` run in-page).
Raw JSON output archived at `spikes/852-mui-evaluation/a11y-results.json`.

- **axe-core scan** of both stories' `Loaded`/`Running` states: **zero
  violations attributable to any MUI component.** The only two violations
  reported (`landmark-one-main`, `page-has-heading-one`, both "moderate")
  are artifacts of testing an isolated component fragment outside a full
  page's `<main>`/`<h1>` chrome inside Storybook's iframe — expected to be
  satisfied automatically once these components render inside a real
  `apps/web` or `apps/ops` page layout.
- **Dialog** (WAI-ARIA dialog pattern): opening moves focus inside the
  dialog; `Tab` was pressed 6 times in a row and focus never left the
  dialog (focus trap holds); `Escape` closes it and returns focus to the
  triggering button. All three verified via direct `document.activeElement`
  inspection, not just visual state.
- **Menu** (WAI-ARIA menu pattern): opening via keyboard (`Enter` on the
  trigger) then `ArrowDown` moves focus to the first `role="menuitem"`;
  `Escape` closes the menu and returns focus to the trigger.
- **DataGrid**: cell-level roving-tabindex keyboard navigation confirmed —
  clicking a cell then pressing `ArrowRight` moves `aria-colindex` from `1`
  to `2` on the focused cell. One anomaly in the raw probe output
  (`spikes/852-mui-evaluation/a11y-results.json`, `datagrid-keyboard`):
  `gridRole` was captured as `null`. This is a probe-selector issue, not a
  confirmed MUI defect — the probe read `role` directly off the
  `.MuiDataGrid-root` element, and `DataGrid` may place `role="grid"` on a
  different internal element than the one that class targets. The
  cell/row-level `aria-colindex`/`aria-rowindex` navigation above still
  passed, which is stronger evidence than the root role check would have
  been, but this should be re-verified with a corrected selector (or a real
  screen-reader pass, see the follow-up below) before treating DataGrid's
  grid-level ARIA role as confirmed.
- **Not performed: a live screen-reader walkthrough** (VoiceOver/NVDA).
  This spike ran in a headless CLI environment with no GUI/audio session
  available. The ARIA contract exercised above (`role="dialog"`,
  `role="menu"`/`"menuitem"`, `aria-colindex`/`aria-rowindex`,
  `aria-haspopup`) is the same contract a screen reader consumes, and it
  matches MUI's documented WAI-ARIA APG-based implementation, but that is
  not a substitute for an actual screen-reader pass. Listed as a required
  follow-up before #853 commits to these components as the accepted
  foundation — see section 8.

## 8. Follow-ups for #853 (not resolved by this spike)

1. **Code-split `DataGrid`** behind `next/dynamic` in every real usage —
   section 5's ops measurement shows what happens without it.
2. **Confirm Ops' actual grid requirements** against the Community-tier
   feature matrix in section 2 *before* committing to MUI X Community as
   sufficient — multi-column filter, pinning, and row grouping are all
   Pro/Premium-gated and therefore unavailable under the workspace's
   Pro/Premium prohibition.
3. **Run a real screen-reader pass** (VoiceOver at minimum) on Dialog,
   Menu, and DataGrid — this spike's a11y evidence is automated-only.
4. **Re-run the interactive click-through/hydration check in a normal dev
   environment**, not this sandbox, to convert section 6's "inconclusive"
   into a real pass/fail.
5. **Escalate the ISC license-allowlist gap** to the maintainer alongside
   `lucide-react`'s existing gap — this spike does not resolve it, per
   `docs/design/ui-boundary-and-ops-workspace.md` section 6 item 2.
6. **Defer SBOM/license-notice tooling** (per section 1) unless the
   maintainer wants it scoped as separate work.
