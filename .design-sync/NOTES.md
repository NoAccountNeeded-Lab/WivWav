# design-sync notes — apps/web

## Setup summary

- `apps/web` has no library build (`next build` only, no `dist`/`main`/`module`) — this sync
  uses **synth-entry mode**: `cfg.entry` unset, `cfg.srcDir: "src/components"` so the
  synthesized entry only sweeps actual UI components, not pages/middleware/lib/api routes.
- The DS package itself (`@wivwav/web`) isn't installed under its own `node_modules` (it's an
  app, not a consumed library), so a scratch "consumer" dir was created at
  `.ds-sync/consumer/node_modules/` with `@wivwav/web` symlinked to `apps/web`, plus `react`/
  `react-dom` symlinked in from `apps/web/node_modules`. All build/validate/capture commands
  pass `--node-modules ./.ds-sync/consumer/node_modules`.
- Converter scripts staged at `.ds-sync/` (gitignored) via the standard `cp -r` step; deps
  (`esbuild`, `ts-morph`, `@types/react`, `playwright`) installed there with plain `npm i`.

## Global fixes baked into config (do not remove on re-sync)

- **`process` shim** (`extraEntries: ["./.ds-generated/process-shim.mjs"]`): bare `process`
  references from bundled Next.js internals (`process.env.__NEXT_ROUTER_BASEPATH` etc., pulled
  in transitively by any component importing `next/navigation`/`next/link`/`next-intl`) throw
  `ReferenceError: process is not defined` in a browser bundle — this shim sets
  `globalThis.process = { env: {} }` before the main entry evaluates (ordered first in the
  synthesized `.bundle-entry.mjs`).
- **Router/i18n context provider** (`extraEntries: [..., "./.ds-generated/preview-provider.tsx"]`,
  `provider: { component: "PreviewProvider" }`): apps/web is a Next.js App Router + next-intl
  app, so ~9 components call `useRouter`/`usePathname`/`useSearchParams` (next/navigation) or
  `useLocale`/`useTranslations` (next-intl) unconditionally at render time. With no real Next.js
  app mounted, these hooks throw `"invariant expected app router to be mounted"` (or next-intl's
  equivalent), which is an *uncaught* render error — the cell just renders blank with no visible
  error text or capture-tool warning (this cost real time to root-cause: `package-capture.mjs`'s
  own error detection missed it because the throw is asynchronous relative to its check).
  `apps/web/.ds-generated/preview-provider.tsx` wraps every preview in `NextIntlClientProvider`
  (real `en.json` messages) plus mock `AppRouterContext`/`PathnameContext`/`SearchParamsContext`/
  `PathParamsContext` providers (imported from Next's internal
  `next/dist/shared/lib/{app-router-context,hooks-client-context}.shared-runtime` — not public
  API, may need re-verifying against `SearchParamsContext` export path on a Next major-version
  bump). It also re-exports `SearchParamsContext` so individual preview files (which live in
  `.design-sync/previews/`, outside `apps/web`, and can't resolve bare `next/...` imports
  themselves) can locally override the mocked value — see `ActiveFilters.tsx` for the pattern
  (it reads real filter state from `useSearchParams()`, so its preview wraps stories in
  `<SearchParamsContext.Provider value={new URLSearchParams(...)}>`).
  **Fixed by this**: SiteHeader, SortSelect, PriceHistogram, YearHistogram, SafetyRefreshButton,
  MileageHistogram, IntakeForm, LanguageSwitcher, CategoryBarChart, ActiveFilters.
- **CSS**: Tailwind v4 (`@import "tailwindcss"`) can't resolve through esbuild's plain module
  resolution (the package's `exports` map has no `import`/`require` condition for bare CSS).
  Fixed by pre-compiling `globals.css` through the real `@tailwindcss/postcss` pipeline (see
  `apps/web/compile-css.mjs` — reusable if globals.css changes materially; run from inside
  `apps/web` so postcss/tailwindcss resolve from its own node_modules) into
  `apps/web/.ds-generated/globals.compiled.css`, which `cfg.cssEntry` points at.
- **Fonts**: `next/font/google` (Plus Jakarta Sans, Raleway) self-hosts at Next build time —
  there's no static `@font-face` source to point `cfg.extraFonts` at directly. Extracted the
  real `@font-face` rules + referenced woff2 files from a `next build` run's
  `apps/web/.next/static/chunks/*.css` + `.next/static/media/*.woff2`, copied into
  `apps/web/.ds-generated/fonts.css` + `fonts-src/`. **Re-sync risk**: if these fonts/weights
  change, re-run `next build` and redo this extraction (grep the css chunks for
  `font-family:<Name>`).
- **`StateHeatMap`** excluded via `componentSrcMap: {"StateHeatMap": null}` — it only has a
  default export (`export default function StateHeatMap`), and synth-entry's `export * from`
  can never re-export a default as a named global (ES spec). Not worth adding a named export to
  production source just for this sync; left as a known gap.

## Known render warns (triaged, not new)

- `[GRID_OVERFLOW]` on FacetModal (portal/fixed-position modal) → `cardMode: "single"`.
- `[GRID_OVERFLOW]` (wide) on ChartContainer, ChartTooltip, ChartTooltipContent, PhotoGallery,
  SiteHeader, PriceHistoryChart → `cardMode: "column"`. All presentation-only overrides in
  `.design-sync/config.json`'s `overrides` key.
- `ErrorBoundary`'s `CaughtError` cell shows an unstyled plain `<button>` — this is the REAL
  production component (`apps/web/src/components/ErrorBoundary.tsx`'s default fallback uses
  hardcoded inline styles, no design-system button). Graded `good` (accurate to source), flagged
  here as a product design debt someone may want to address in the app itself, not a sync issue.
- Recharts primitives `ChartTooltip`/`ChartLegend` can't be composed in isolation (they're bare
  `RechartsPrimitive.*` wrappers that only render meaningfully inside a live `<BarChart>`/
  `<LineChart>` with real data) — their previews use hand-drawn static SVG charts standing in
  for a live Recharts chart, since `recharts` isn't in the synth-entry consumer's node_modules.
  `ChartTooltipContent`/`ChartLegendContent` are plain presentational and don't have this issue.

## Skipped — genuinely non-visual (floor card is correct, not a gap)

`FetchErrorMonitor`, `GlobalErrorHandlers` (both always return `null`, side-effect-only),
`ListingsVisitSession` (renders only `{children}` inside a context provider), and
`NavigationFocusReset` (pure focus-management effect, always returns `null`).

## Re-sync risks

- The `preview-provider.tsx` mock router/context values are static (fixed pathname
  `/discover`, empty search params by default, en-only messages) — a component whose behavior
  meaningfully branches on a *different* pathname or locale won't be exercised by the default
  provider; per-story overrides (like `ActiveFilters`) are the escape hatch, follow that pattern
  for any newly-added router/locale-dependent component.
- `next/dist/shared/lib/{app-router-context,hooks-client-context}.shared-runtime` are internal
  Next.js paths, not public API — verify they still exist/export the same names after any Next
  major-version bump (checked against next@16.2.10 here).
- `apps/web/.ds-generated/fonts.css` + `fonts-src/` are a point-in-time extraction from a
  `next build` run on 2026-07-12 — re-extract if font families/weights change.
- `apps/web/compile-css.mjs` + `globals.compiled.css` likewise need re-running if
  `globals.css`'s Tailwind usage changes materially (new utility classes used in components that
  weren't previously scanned).
