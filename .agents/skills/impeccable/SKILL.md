---
name: impeccable
description: Read-only cross-agent product-design critique for WivWav (audit, critique, layout, typeset, polish, harden). Use to evaluate an existing mobile-first surface or ops dashboard against scanability, consistency, and craft standards before or during UI work. Defers to docs/BRAND.md and AGENTS.md; does not authorize implementation on main or bypass the issue/branch workflow.
argument-hint: "[audit|critique|layout|typeset|polish|harden] [route-or-component]"
user-invocable: true
---

# Impeccable (WivWav-adapted)

Adapted, safety-reduced subset of [pbakaus/impeccable](https://github.com/pbakaus/impeccable)
(Apache-2.0), retargeted from a general-purpose install-and-hook design tool into a **read-only
critique reference** for WivWav. See `.agents/skills/impeccable/PROVENANCE.md` for the pinned
upstream revision, license, what was excluded, and how to update or remove this skill.

This skill provides *design judgment*, not authority. It never overrides WivWav's own rules.

## 0. Authority and precedence (read first)

When guidance conflicts, resolve in this order — highest wins:

1. `AGENTS.md` — repository workflow and safety (issue/branch discipline, review gates, API and
   data rules). Always applies, even if this skill is not loaded.
2. `docs/BRAND.md` — the current product/UI and accessibility authority for WivWav. Its rules
   (mobile-first, restrained visual direction, WCAG 2.1 AA, layout rules) are non-negotiable and
   are not "one input among several" for this skill.
3. This skill (`impeccable`) — general design-craft judgment (scanability, hierarchy, consistency,
   restraint, production polish) used to *evaluate* a surface against BRAND.md and to phrase
   findings, never to introduce a competing visual direction.

This skill does not define or generate a `PRODUCT.md` or `DESIGN.md`. `docs/BRAND.md` is the only
committed product/design source of truth for WivWav; do not create a parallel one. If a command
below would normally produce or consult a brief file, treat `docs/BRAND.md` (and, for chart/tile
color and density, the `dataviz` skill) as that brief instead.

This skill cannot:

- authorize editing on `main`/`master`, or skip the issue → branch → review → PR workflow in
  `AGENTS.md`;
- approve or waive a `docs/BRAND.md` review requirement for `apps/web` UI changes;
- write `PRODUCT.md`, `DESIGN.md`, or other project files on its own initiative;
- make network calls, launch a browser, or run install/hook scripts (see §2).

## 1. Commands (read-only critique only)

Invoke these as structured review passes over code you already have open — narrated findings, not
autonomous edits. Each maps to an upstream Impeccable command, reduced to its critique behavior:

| Command | What it evaluates |
| --- | --- |
| `audit` | Deterministic anti-patterns: inconsistent spacing units, ad hoc hex colors instead of tokens, missing focus states, unlabeled interactive controls. |
| `critique` | Overall hierarchy, scanability, and whether the surface matches its **mode** (see §3). |
| `layout` | Grid/flow structure, information density, and whether related content is grouped predictably. |
| `typeset` | Type scale consistency, line length, and readability at mobile widths. |
| `polish` | Small consistency gaps: hover/focus/disabled state coverage, spacing rhythm, icon/label pairing. |
| `harden` | Production-readiness: loading, empty, and error states; whether interactive controls keep a stable size (per `docs/BRAND.md`); keyboard reachability. |

Every command:

- reads files and states findings; it does not run scripts, edit files, or install anything;
- must cite the WivWav rule a finding violates (`docs/BRAND.md` section, `AGENTS.md` line, or a
  WCAG 2.1 AA success criterion) rather than a generic aesthetic preference;
- for `apps/web`, runs alongside — never instead of — the `wav-a11y-audit` skill for anything
  claiming an accessibility result; this skill's `harden`/`critique` output is a design-judgment
  read, not a substitute for the axe-core/eslint-plugin-jsx-a11y scan.

## 2. What was deliberately excluded

Upstream Impeccable also ships an install step, provider-native hooks (`scripts/hook.mjs`,
`hook-before-edit.mjs`), a "live" browser-iteration mode (Puppeteer/DOM injection, screenshot
capture, auto-committing manual edits), and an image-generation command that calls an external
API. None of that is vendored here:

- **No hook installation.** This skill is invoked explicitly, like any other WivWav skill; it does
  not register a `PreToolUse`/`PostToolUse` hook that runs automatically on every file edit.
- **No live browser mode.** No Puppeteer/DOM automation, no autonomous screenshotting, no
  auto-commit of "manual edits." WivWav's own accessibility and E2E automation already lives in
  `apps/web/e2e` and the `wav-a11y-audit` skill; this skill does not duplicate or bypass it.
- **No network calls.** No image generation, no URL scanning/`detect` against a live target.
- **No autonomous file writes.** Findings are reported in conversation or committed by a human/
  agent through the normal review flow, never written by a script this skill runs.

If a future issue wants any of the excluded automation, it needs its own safety review (network
egress, credentials, browser-sandbox implications per `AGENTS.md`'s scraper rules) and its own
acceptance criteria — this issue intentionally does not authorize it.

## 3. Modes

Judge a surface against the mode it actually serves, not a generic checklist:

- **Operate** (WivWav ops dashboards under `apps/ops`, e.g. `/ops/queues`, `/ops/readiness`):
  optimize for scanability and consistency under real data density — many rows, live-refreshing
  numbers, status chips. Favor familiar, low-novelty controls over cleverness.
- **Persuade/shop** (WivWav public surfaces under `apps/web`, e.g. `/discover`, `/results`,
  listing detail): optimize for fast comparison and a confident next action on a small screen
  first. `docs/BRAND.md` already states this is not a marketing landing page — do not push toward
  decorative treatments.

WivWav has no "Read" (docs/article) or "Experience" (portfolio) surfaces in scope for this skill;
if one is added later, extend this table rather than forcing it into Operate or Persuade.

## 4. Using this skill

1. State which command(s) and which surface (route/component) you're evaluating.
2. Read the actual source (and, for `apps/web`, `docs/BRAND.md`) before writing any finding.
3. Report findings as: what you saw, which rule it violates, and a concrete fix — no open-ended
   restyling proposals.
4. If a finding implies a UI change, stop and hand it back through the normal WivWav workflow
   (issue, branch, `docs/BRAND.md`-aware review) rather than editing directly from this skill.
