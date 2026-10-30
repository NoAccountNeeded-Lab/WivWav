# Issue #1233 verification

Date: 2026-10-30. Branch:
`feat/issue-1233-add-wav-shopping-filters-with-safe-index-rollout`.
Worker 1, sprint `run-sprint/2026-10-30T10:30`.

## Acceptance evidence

| Acceptance criterion | Evidence |
| --- | --- |
| City/state identity, normalized transmission, exact positive capacity, existing conversion status throughout the flow | Shared `shopping-filters` helpers and search document/settings tests; API listing/search/facet tests; web chart/query/chip tests. City uses one `cityState` projection value per city/state pair; raw source fields remain. |
| Reject malformed/negative/fractional/out-of-range capacity; missing differs from zero | Both API endpoints test blank, 0, -1, 1.5, 7, 10, NaN, trailing/repeated commas, leading zero, exponent, whitespace and suffix forms; shared/index tests cover null, invalid values and bounds 1/6. |
| Old URLs, OR within facets, AND between facets, disjunctive counts, explicit states, conflicting cities removable | Numeric filter-string and filter-builder tests; legacy/current URL round trips; chart tests inspect omitted-city requests retaining explicit state and mobility filters; chip tests remove only one conflicting pair; outgoing histogram tests retain trim and all other constraints while omitting only their own range. |
| Fail closed; no database search fallback | Existing listing outage tests pass. New-filter queries get 503 while the gate is held; legacy URLs remain usable. No database fallback was added. |
| Existing rebuild/swap, completion verification, cache cutover and rollback before controls | Full-sync tests cover settings/batch waits, count reconciliation, versioned swap and failure safety. Completion is now emitted after successful swap. Gate defaults off. Held/ready v3 namespaces exclude old/pre-rebuild facets. [Runbook](../ops/shopping-filters-rollout.md) requires verified rebuild and cache invalidation before enabling and documents previous-application plus authoritative-DB rebuild rollback. Production execution is pending and was not authorized in this task. |
| Focused contract/regression tests | Types 285 tests, search 62 tests, API 1,550 tests and web 633 tests pass, including new normalization/API/filter/index/URL/chip/disjunctive/histogram cases. |
| API documentation | `docs/api-routes.md` records additive query parameters, exact capacity/status semantics, new breakdowns, readiness and 503 behavior; no routes added or renamed. |

## Checks

- `pnpm typecheck`: passed, 30/30 Turbo tasks.
- `pnpm lint`: passed, 21/21 tasks, including web jsx-a11y checks.
- `pnpm build`: passed, 18/18 tasks, including API, web and ops.
- `pnpm test`: passed, 27/27 tasks on the final sequential run.
- `git diff --check`: passed before commits.
- Built-container `pnpm test:e2e`: blocked before browser tests. Docker migrate-image Prisma generation failed with `ENOSPC: no space left on device` while unlinking `/app/packages/db/src/generated/prisma/index.js`; API/web image builds were canceled. No shared Docker resources were pruned. Free Docker storage through the approved operator workflow, then rerun the suite on the final branch.

Local validation needed approved sandbox access for Prisma's engine cache,
Chromium/local fixture servers, Docker, and the production compiler. The SWC
native cache was redirected to `/private/tmp/wivwav-1233-swc`. The initial
sandboxed full test run failed on unchanged local-HTTP/Chromium scraper tests;
an escalated run hit a single 15-second HTTP-fixture timeout during concurrent
builds. The isolated fixture retry passed all three cases in 2.41 seconds, and
the final sequential full run passed. No source changes were made for these
validation-environment failures. The built-container run additionally encountered
registry/socket retries, then exhausted Docker storage during image generation;
its browser, axe and application smoke assertions did not execute.

## Blocking review

One foreground reviewer applied reviewer, QA, performance, accessibility and
docs-accuracy roles to every changed file. Fixed two warnings and one suggestion:

1. Added missing trim forwarding to all three histograms, with outgoing-request tests.
2. Bounded city-chip width and wrapped long labels; the removal target cannot shrink.
3. Localized transmission/status labels for English, Spanish and ZZ, preserving CVT.

Re-review returned **REVISION_NEEDED: no**, with no remaining code findings.

## Accessibility evidence and limits

- Static `wav-a11y-audit` web lint passed.
- Component tests verify named native buttons, pressed state for capacity and
  conversion status, selected zero-count city availability, individual chip
  removal, Spanish labels and an accepted 100-character city label.
- An isolated Chromium fixture using the actual changed chip stylesheet passed
  at a 320px viewport with normal and 200% root text: document width stayed 320px;
  removal targets measured 44×44px and 88×88px, within the viewport. This is
  component-layout evidence, not a full application accessibility audit.
- Existing focus styles, non-color pressed-state semantics, text alternatives
  and reduced-motion styles are retained. No new chart renderer or animation.
- Full-app axe, keyboard flow, screen-reader operation, contrast, 320px reflow,
  and 200% zoom remain unverified against the changed running application:
  the approved `make dev` server was unavailable, and the audit skill forbids
  starting a worker-owned replacement. Complete these before enabling controls.

## Release limits

No database/schema change. No push, PR, merge, production deployment, production
index rebuild or control enablement was performed. The default-off gate must
remain held until the runbook's verified rebuild, cache cutover, application
smoke checks and accessibility checks pass. The rollback path rebuilds from
PostgreSQL; it does not assume a retained pre-swap index.
