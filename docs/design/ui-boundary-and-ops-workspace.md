# Shared web UI boundary and Ops workspace: decision record

Status: architecture-review discussion on #851 is complete and implementation
is split into child issues (below), pending final review sign-off on #851
itself. This document is the durable record of what was decided, what
remains a maintainer call, and how existing UI issues are dispositioned. It
supersedes the issue-comment discussion as the source of truth going forward.

Participants: Codex (OpenAI) and Claude (Anthropic) recorded signed
architecture-review comments on #851. This document consolidates their agreed
position; direct disagreements are called out explicitly in the section that
covers them.

## 1. Package boundary and diagram

```text
                         @wivwav/types
                  platform-neutral domain logic
                @wivwav/design-tokens (semantic, data-only)
                         /               \
              @wivwav/ui-web       @wivwav/ui-native (future, not built now)
                 /       \                  |
            apps/web   apps/ops       React Native app (not built now)
```

- `@wivwav/types`: already exists; stays free of React, DOM, Next.js, Prisma,
  and Node-only types so it is reusable by a future native app.
- `@wivwav/design-tokens` (new): platform-neutral semantic tokens (color
  roles, spacing scale, type scale, motion durations) expressed as plain data
  (TS objects/JSON), not CSS or React. `ui-web` is the only package allowed to
  turn these into CSS variables/MUI theme objects.
- `@wivwav/ui-web` (new): the only package permitted to import a component
  vendor (MUI Core / MUI X Community, pending the spike in child issue A). It
  exports a small, policy-bearing surface — provider/theme, Button,
  IconButton, Link, Dialog/Drawer, Menu/ContextMenu, Tooltip, form controls,
  status/badge presentation, and accessibility defaults — plus acknowledged
  re-exports (e.g. a data grid) for advanced widgets where a wrapper would add
  no value.
- `apps/web` and `apps/ops`: consume `@wivwav/ui-web` and `@wivwav/design-tokens`
  only; keep product composites local (`OpsPanel`, `RunTimeline`,
  `LogViewer` in `apps/ops`; `ListingCard` in `apps/web`) until a second real
  consumer demonstrates reuse.
- `@wivwav/charts` and `@wivwav/ui-web` are both browser-specific (Recharts,
  Radix, MUI are all DOM-dependent). A future `@wivwav/ui-native` would
  translate `@wivwav/design-tokens` into native primitives; it is not created
  until a native app is actually scheduled.

### Mobile seam (decision area 7)

What is genuinely portable to a future native app, and therefore must stay
free of DOM/Next.js/browser-only APIs: `@wivwav/types`, validation logic,
formatters (currency, distance, date/time), domain logic, the API client and
its query/caching semantics, and `@wivwav/design-tokens`' semantic data.
What stays platform-specific and is never pulled into a "shared" package:
DOM rendering, Next.js routing, browser storage-backed auth/session state,
`@wivwav/charts` (Recharts/Radix), and native navigation. This list is the
answer to decision area 7; no further escalation is needed unless a native
app is actually scheduled, at which point `@wivwav/ui-native` is created per
the diagram above rather than retrofitted onto `@wivwav/ui-web`.

### Import rules (enforced via lint, not convention)

- `apps/web/**` and `apps/ops/**` must not import `@mui/*`, `@emotion/*`, or
  any future component vendor directly. Add an ESLint `no-restricted-imports`
  rule in `packages/config/eslint.config.js` scoped to those two app
  workspaces once `@wivwav/ui-web` exists; land it in the same child issue
  that introduces the package so there is never a window where direct vendor
  imports are legal but unenforced.
- `@wivwav/ui-web` must not import from `apps/web` or `apps/ops` (already
  covered by existing workspace/package boundary conventions).
- `@wivwav/design-tokens` must not import React, `next`, or any DOM types.

## 2. Component dependency candidate and license matrix

This is a **spike deliverable, not a settled choice** — see decision area 2
below. The matrix records what the spike (child issue A) must verify before
either app takes a dependency on it.

| Package | Role | License | Notes |
|---|---|---|---|
| `@mui/material` | Core components + theming | MIT | Direct runtime dep of `ui-web` only. |
| `@mui/system` | Style engine primitives used by `@mui/material` | MIT | Transitive via `@mui/material`. |
| `@emotion/react`, `@emotion/styled` | CSS-in-JS engine MUI uses by default | MIT | Adds a second styling runtime alongside Tailwind (`apps/web`) and CSS Modules (`apps/ops`); the spike must measure the SSR/bundle cost of running both. |
| `@mui/x-data-grid` (Community) | Data grid | MIT | **Community edition only.** `@mui/x-data-grid-pro` and `-premium` are commercial (proprietary EULA, not MIT) and must not be added as a dependency anywhere in the workspace. Required grid behaviors (multi-column filter, pinning, grouping, export) must be checked against the Community feature list before any acceptance criteria assume them. |
| `react-transition-group` | Transitions used internally by MUI | BSD-3-Clause | Transitive; compatible with `.claude/core.md`. |
| `lucide-react` | Existing icon dependency in both `apps/web` and `apps/ops` | ISC | Already a runtime dependency today, predates this issue. `.claude/core.md`'s allowlist (MIT, Apache-2.0, BSD, PostgreSQL License) does not currently list ISC. This is a **root policy gap, not a new risk introduced by this issue** — flagged for the maintainer in decision area 8 rather than silently resolved here. |

Compatibility check required by the spike, recorded here so it isn't lost:
Next.js 16 / React 19 SSR and hydration behavior, App Router streaming,
keyboard/screen-reader behavior for Dialog/Menu/DataGrid, and production
bundle delta for one representative `apps/web` route and one representative
`apps/ops` route. Exact pinned versions and the full transitive license list
must be captured in the spike's own PR (via `pnpm licenses list` or
equivalent) rather than hand-maintained here, since they will drift.

No SBOM or automated license-notice generation exists in this repository
today. The spike should decide whether one is introduced now or deferred, and
say so explicitly rather than assuming either answer.

## 3. Ops workspace contract

Applies to the future dynamic Ops workspace (child issue C). Existing
`apps/ops/src/components/Inspector` (the E6 inspector from #761's scope) is
the closest existing implementation and should be adapted rather than
replaced outright, per the disposition in section 5.

- **Panel identity**: every panel has a stable, URL-addressable ID composed of
  `{entityType}:{entityId}` (e.g. `run:1234`, `source:blvd`, `queue:scrape`).
  Multiple panels of different entity types may be open at once; opening a
  panel already open focuses it rather than duplicating it.
- **Entity relationships**: a panel may expose links to related entities
  (a run panel links its source, its logs, and its queue job); following a
  link opens or focuses the related panel without closing the current one,
  consistent with the "no manual identifier copying" goal in #851's problem
  statement.
- **URL state**: the full set of open panels, their order, spans, and which
  panel (if any) is maximized is serialized into the URL (query string or
  path segment) so a deep link reproduces the exact workspace state. This
  directly extends what #761 already proposes for run/source/queue/log
  drill-down.
- **Layout / span**: panels lay out in an ordinary CSS Grid; a panel may
  declare a column span (e.g. 1, 2, or full-width) but arbitrary drag/drop
  repositioning is out of scope for the first iteration (non-goal, carried
  over unchanged from #851).
- **Resize**: only where operator-controlled resizing is actually needed
  (e.g. a log panel next to a metrics panel) does a panel pair get a
  resizable split, via one focused split/resize dependency rather than a
  general drag-and-drop framework.
- **Maximize/restore**: maximize is a workspace layout mode (the panel
  occupies the full workspace viewport), not a modal dialog, so it must not
  reuse dialog focus-trapping. Concretely: other panels are removed from
  layout (e.g. `display: none` or unmounted, not merely occluded underneath
  the maximized panel) while maximized, so they are simultaneously invisible
  and out of the tab order — never visually hidden but still keyboard-
  reachable, and never present-but-untabbable either. Escape restores the
  previous layout, restoring the other panels to the DOM/tab order at the
  same time they become visible again; the maximized state is part of URL
  state so it survives reload/share; focus moves to the panel's primary
  heading on maximize and returns to that panel's trigger (or the heading, if
  the trigger no longer exists) on restore.
- **Scroll ownership**: each panel owns its own internal scroll region; the
  workspace shell itself does not scroll horizontally, matching the existing
  no-horizontal-scroll rule already applied elsewhere in the product.
- **Accessibility**: panels are landmark regions with an accessible name
  derived from entity identity; panel open/close/focus/maximize/restore are
  all keyboard-operable; the same entity actions are exposed through visible
  buttons, an overflow menu, and a keyboard-accessible context menu (right
  matches the requirement in #851's context — no action is context-menu-only).
- **Narrow-screen behavior**: below the layout's mobile-first breakpoint,
  panels stack to a single column and open as a full-screen view rather than
  a small tile; the Ops audience is desktop-first but the shell still must
  not break down to zero usability on a narrow viewport per `.claude/core.md`'s
  mobile-first rule.

## 4. Test strategy

| Layer | Owns | Tooling |
|---|---|---|
| Package unit tests | Pure logic in `@wivwav/design-tokens` and any non-visual logic in `@wivwav/ui-web` (e.g. a `useMaximizedPanel` hook) | Vitest, existing convention |
| Storybook interaction/accessibility/visual | WivWav-authored states and behavior of `@wivwav/ui-web` components and Ops-local composites (`OpsPanel`, `RunTimeline`, `LogViewer`) — loading/error/empty/running states, keyboard interaction, axe checks, and visual snapshots | Storybook + its test runner/addon-a11y/visual-regression addon (introduced with the `ui-web` foundation child issue) |
| Integration tests | `apps/web` and `apps/ops` route-level composition — that panels render, links resolve, and API data flows through correctly | existing Vitest + Testing Library convention in each app |
| End-to-end | Full operator workflows: opening a run, following its links to source/logs, resizing, maximizing, reloading a deep link and getting the same workspace state back | existing Playwright `e2e` package |

Explicitly out of scope at every layer: re-testing MUI's own component
behavior (focus trapping inside `Dialog`, virtualization inside `DataGrid`,
etc.) — that is the vendor's test suite's job. WivWav tests cover WivWav
behavior and states built on top of the vendor.

## 5. Disposition of existing issues

| Issue | Disposition | Rationale |
|---|---|---|
| #755 (theme contrast audit, 22 `ThemePicker` variants confirmed in `apps/ops/src/styles/themes.css`) | **Narrowed, not implemented as-is.** Do not audit all 22 variants. Once child issue B selects the retained appearance(s), re-scope #755 to only the themes still in use during migration, or close it as superseded by `ui-web`'s token/contrast validation (which will be exercised through Storybook accessibility tests per section 4). | Auditing variants scheduled for retirement is throwaway effort. |
| #758 (unified Problems surface) | **Blocked on child issue C** (Ops workspace/panel contract) for its UI; the server-side lifecycle/aggregation/fingerprinting work is UI-independent and may proceed in parallel now. | The Problems surface should consume the same panel/entity conventions being defined in C; building it first would mean building a second, incompatible detail system. |
| #760 (calm the overview / reserve color for exceptions) | **Retained, rebased on the selected foundation.** Behavioral goal (calm healthy-state hierarchy) survives unchanged; implementation should land on `@wivwav/design-tokens` semantics rather than the current theme layer once child issue B exists. | Avoids implementing the same visual-hierarchy goal twice. |
| #761 (deep-link failures via the E6 inspector) | **Retained as the first production workspace consumer**, adapted rather than rewritten. Its run → source → queue → log drill-down becomes the proving ground for the panel contract from child issue C before any other screen migrates. | Directly validates URL state, entity relationships, and panel behavior end-to-end before wider adoption. |
| #762 (legibility pass — sans-serif UI, monospace for data) | **Retained, rebased on the selected foundation**, same as #760: implement via tokens/`ui-web` typography scale rather than the legacy CSS once available; may run in parallel with #760. | Behavioral requirement is independent of which component library backs it. |

Maintainers should update each issue's labels/status to match (removing
`status:ready` where a blocking dependency now exists) as part of triaging
the child issues below; this document and the #851 issue comments are the
record of *why*.

## 6. Decisions escalated to the maintainer

Per #851's own framing, these are product/business calls this document does
not make unilaterally:

1. **Final component-library acceptance** (decision area 2): MUI Core + MUI X
   Community is the leading candidate to *spike*, not the accepted choice.
   Acceptance, rejection, or comparison against one named alternative happens
   after child issue A reports evidence (bundle size, SSR behavior,
   accessibility, wrapper cost).
2. **Runtime license allowlist gap**: `.claude/core.md` allows MIT,
   Apache-2.0, BSD, and PostgreSQL License, but `lucide-react` (ISC) is
   already a runtime dependency of both apps today. The maintainer needs to
   either add ISC to the allowlist or direct a replacement/justification;
   this issue does not change `.claude/core.md` unilaterally.
3. **Retained Ops theme scope**: which of the 22 `ThemePicker` variants (if
   any) are worth preserving through migration versus retiring immediately is
   a product call, not an architectural one.
4. **SBOM / license-notice process**: whether one is introduced as part of
   this migration or tracked as separate future work.

## 7. Child issue decomposition and migration order

Created as separate, independently implementable issues:

1. **#852** — Dependency, license, and framework-compatibility spike for
   `@wivwav/design-tokens` + `@wivwav/ui-web` (evaluates MUI Core + MUI X
   Community; no production migration).
2. **#853** — Minimal `@wivwav/design-tokens` + `@wivwav/ui-web` foundation
   package (provider/theme, the narrow primitive surface from section 1,
   Storybook harness, import-restriction lint rule). Depends on #852.
3. **#854** — Ops workspace/panel contract implementation (section 3), built
   on the foundation from #853, adapting the existing Inspector. Depends on
   #853.

Order: **#851 (this record) → #852 (spike) → #853 (foundation) → #854
(workspace contract) → #761 (first real consumer) → #760/#762 in parallel →
#758 UI**, with #755 narrowed or superseded per section 5. `apps/web`
migrates incrementally through separately scoped future issues, starting
with policy-bearing primitives when a component is newly built or
materially changed — not a route-wide rewrite.
