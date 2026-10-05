# Helm (#1071) validation record

Evidence for the acceptance criteria, check results, and known gaps. Design reasoning for the charts is in `docs/ops/helm-data-display.md`.

## Acceptance evidence

| Criterion | Evidence |
| --- | --- |
| `GET /internal/ops/helm-summary` | API route and tests from the slice-1 commits; documented in `docs/api-routes.md`. Unchanged by the chart work. |
| Navigation, inventory definitions, connected stages, backlog and run bars with numbers and windows, no invented trends | `HelmWorkspace.test.tsx` (stages, queue summary, collapsed Queue details, view switch, empty/unavailable states, run window); `queue-work-model.test.ts`, `run-history-model.test.ts`, `flow-model.test.ts`; E2E `helm-charts.spec.ts`. Delayed work is separate and never backlog; no queue or inventory history is drawn. |
| Existing capabilities, 15 s non-overlapping refresh, stale retained, missing never healthy | Prior slice tests; E2E "missing queue data is unknown, not zero, and a failed refresh keeps the last reading marked stale". |
| Shareable selection, What happened / Impact / Evidence / Actions | Prior slice tests; E2E "a shared URL reopens the same investigation". |
| Run source / crawl / extraction, confirmation, completed != recovered | E2E journey: enqueue failure, completion without recovery, recovery from fresh evidence, vanished problem with an unavailable signal. |
| Nonmodal resizable desktop inspector; narrow dialog focus restore; readable chart alternatives | E2E keyboard resize and narrow focus trap/restore/inert; charts have text beside each bar, a summary sentence, a keyboard tooltip (arrow keys) and a details table. |
| Tests, typecheck, lint, build, focused E2E, gaps recorded | Below. |

## Check results (final code, 2026-10-04)

- Final code: `pnpm typecheck` 30/30 tasks, `pnpm lint` 21/21, `pnpm build` 18/18, `lockf -k /tmp/wivwav-test.lock pnpm test` 26/26, all in one chain on the first run.
- An earlier full-test run on the previous commit needed three attempts: the first two failed only from CPU contention (load average about 30 from other sessions) with different tests each time (browser-launch hook, 5 s jsdom timeouts, cascading follow-ons), each passing alone; `@wivwav/ops` alone passed 84 files, 685 tests.
- `pnpm --filter @wivwav/e2e e2e:helm`: 13/13 (6 journey, 7 chart tests including a phone-width no-clipped-text check), run against `next build` + `next start` on port 54002 because a `next dev` for this worktree already occupies the app (see `e2e/playwright.helm.config.ts`). This E2E is route-mocked.
- Axe (`@axe-core/playwright`, WCAG 2.0/2.1 A and AA) is clean on Flow with Queue details open and on Activity with Run details open. Its first runs found real failures that were fixed: low-contrast raw queue names, muted card text (3.52:1) and the danger chip (4.25:1).
- Narrow check (390 px): no page-level horizontal overflow; wide tables scroll inside a focusable, named region.
- Colour: dataviz validator passes danger vs primary in the ops grafana dark and light tokens. Red vs green failed colour-vision separation (deutan dE 1.3 light), so history does not use green for success.
- Screenshots: `/tmp/helm-chart-queues-desktop.png`, `/tmp/helm-chart-queues-narrow.png`, `/tmp/helm-chart-flow-desktop.png`, `/tmp/helm-chart-flow-narrow.png`, `/tmp/helm-chart-activity-desktop.png` (not committed).

## History limits

- Scrape history is the 100 most recent runs from `GET /admin/runs`, all sources. No scrape-run cleanup job was found in `apps/api`, but the endpoint caps the page, and the display says older runs are not shown when full.
- No queue-depth, throughput, duration, rate or inventory history is stored, so none is drawn. No migration, snapshot table or new API route was added.

## Known gaps

- The E2E is route-mocked (`e2e/helm/fake-api.ts`). A separate read-only live smoke (GETs and view toggles only, no mutation) on the isolated preview at port 4402 rendered real data: 23 queues, 0 waiting or running, 33 delayed; and 37 scrape runs, all failed, across 6 sources. It found two defects, fixed in the last commit (empty stage bars when nothing is waiting; long labels clipped at 390 px). Repeated live page loads briefly tripped the API rate limit (429) and showed "unavailable", which is the intended handling. No live recovery was run, and the live view was not re-screenshotted after the fix.
- The Discovery stage card shows "Has exceptions" from BullMQ's retained failed count (43 live), which is not a current failure. This logic predates the chart work and was left unchanged.
- Flow does not show scrape history beside the current queue numbers; Activity does. Each is labelled with its own window.
- No manual screen-reader pass (axe and keyboard tests only).
- The `/helm` bundle size was not measured; Recharts now ships in the Helm client chunk.
- The chart view choice is component state, not in the URL, so a shared link does not carry it.
- Light themes were checked by token contrast with the validator, not in a browser; `/helm` does not mount the theme picker, so it renders the default theme.
- `apps/ops/AGENTS.md` and `apps/ops/CLAUDE.md` are generated by Next tooling and are not committed.
