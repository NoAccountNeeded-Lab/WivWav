---
name: wav-a11y-audit
description: Run an automated WCAG 2.1 AA accessibility scan against apps/web (axe-core via Playwright, plus eslint-plugin-jsx-a11y static checks). Use before or during apps/web UI work, and as evidence for the accessibility review role.
argument-hint: "[route] [--static-only|--runtime-only]"
user-invocable: true
---

# WAV accessibility audit

Adapted from [airowe/claude-a11y-skill](https://github.com/airowe/claude-a11y-skill), retargeted to
this repo's existing Playwright setup (`apps/web/e2e`) instead of a standalone browser-automation
step, and scoped to the routes and controls `docs/BRAND.md` calls out as accessibility-critical
(filters, listing cards, detail pages).

Static and runtime checks are independent — run both unless the caller passed
`--static-only`/`--runtime-only`.

## 1. Static: eslint-plugin-jsx-a11y

Already wired repo-wide in `packages/config/eslint.config.js` (`jsx-a11y/recommended` for every
`**/*.tsx` file — WCAG 2.1 AA is mandated in `.claude/core.md`). Do not add a second copy of the
plugin to `apps/web/eslint.config.js`; that duplicate-registers the plugin and breaks lint. Just run:

```bash
pnpm --filter @wivwav/web lint
```

Report each `jsx-a11y/*` violation as file:line, rule id, and a one-line fix; ignore unrelated
warnings (e.g. `i18next/no-literal-string`) unless the issue is specifically about them. Known
false positives in this codebase: Radix UI primitives that forward `role`/ARIA props through to
their rendered element — verify against the Radix docs before flagging.

## 2. Runtime: axe-core via Playwright

Reuse the running dev server (`make dev`, web app on `http://localhost:4000`); do not start a
second server. If it isn't already running, say so and stop rather than starting one yourself —
`make dev` also owns Postgres/Valkey/Meilisearch and a worker-started server would be orphaned.

Scan these routes at minimum (extend if the issue touches other pages):
- `/` (listing search — filters, listing cards, result count)
- a listing detail page (`/listings/[id]` with a real seeded id)
- any route the current issue's diff touches

For each route, drive it with `@playwright/test` (already a devDependency) and inject axe-core:

```javascript
import { test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright"; // add as devDependency if missing

test("a11y: /", async ({ page }) => {
  await page.goto("http://localhost:4000/");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  console.log(JSON.stringify(results.violations, null, 2));
});
```

Run as a one-off (`pnpm --filter @wivwav/web exec playwright test <tmp-spec> --reporter=list`),
not as a permanent addition to `apps/web/e2e` unless the issue asks for a regression test —
delete the scratch spec file afterward.

Additionally verify, since these are exactly the controls `docs/BRAND.md` and
`.claude/roles/accessibility.md` call out and axe-core under-detects them:
- Ramp/lift/conversion-type/wheelchair-capacity filter controls are keyboard-operable and
  announce their current value to a screen reader (not just visually, e.g. via a checked
  checkbox icon with no accessible state).
- Touch targets on filter and listing-card controls are `>= 44x44px`.
- The page reflows without horizontal scroll or clipped content at 320px width (WCAG 1.4.10).
- Text remains readable, unclipped, and non-overlapping at 200% zoom / text-spacing (1.4.4, 1.4.12).
- Focus indicators are visible on every interactive filter and listing control (2.4.7).

## 3. Report

```
## Accessibility audit — [routes scanned]

### Static (eslint-plugin-jsx-a11y)
[violations or "none"]

### Runtime (axe-core, WCAG 2.1 AA)
| Route | Violations | Worst impact |
|-------|-----------|---------------|
...

### Manual checks (filters, reflow, zoom, focus)
[pass/fail per item above]

### Summary
Critical: n | Serious: n | Moderate: n | Minor: n
```

This skill produces evidence, not a verdict — findings still need triage through
`.claude/roles/accessibility.md`'s `REVISION_NEEDED` gate during review.
