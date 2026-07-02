<!-- schema-version: 1 -->
# Usage Report: Issue #529

## Metadata

- Sprint run: run-sprint/2026-06-30T08:37
- Branch: feat/issue-529-match-non-vin-duplicate-listings-with-conservative
- Effort guidance: high
- Model guidance: sonnet

## Phase Usage

| Phase | Agent role/index | Provider | Model | Input tokens | Output tokens | Cache read tokens | Cache write tokens | Tool calls | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| run-sprint | orchestrator/0 | n/a | n/a | unavailable | unavailable | unavailable | unavailable | deterministic CLI | Prepared worktree and context artifacts. |
| implementation | worker/1 | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | unavailable | Added `apps/scraper/src/engine/vehicle-identity-matcher.ts` (pure, documented non-VIN matcher: stable-identifier auto-link vs. fuzzy-candidate-only scoring, negative-evidence hard gate for conflicting VIN/incompatible make-model-year/explicit image conflict) and `apps/scraper/src/jobs/match-vehicle-identity.ts` (job wrapper: buckets unmatched listings by make/model/year, persists decisions via the #528 idempotent `upsertVehicleIdentityDecision`, auto-links via shared non-VIN `Vehicle` rows under per-listing locks). Added 12 matcher unit tests and 7 job tests covering all 5 AC scenarios. Queue/cron wiring intentionally left out of scope (later #504 split). |
| review | reviewer/1 | Anthropic | Claude Sonnet 4.6 | 64326 (subagent cache-read total) | unavailable | unavailable | unavailable | ~20 | Reviewer role covering reviewer.md, qa.md, performance.md. Verdict REVISION_NEEDED: yes; 1 CRITICAL (missing `syncListings` call after auto-link `vehicleId` mutation — fixed), 1 SUGGESTION (silent vehicleId reassignment edge case — fixed via `reassignedFrom` audit signal), 2 SUGGESTIONs accepted as documented follow-ups (unbounded backlog findMany at scale, image-hash wiring deferred until #503 lands). |
| finish | worker/1 | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | unavailable | Applied review fix, re-ran full scraper test suite (539/539 passing) and repo-wide typecheck, posted verdict comment, ran wivwav-finish-issue. |

Token and cache counters are not fully exposed by this runtime; subagent totals are reported where available via task-notification usage metadata.

---

# Usage Report: Issue #531

## Metadata

- Sprint run: run-sprint/2026-06-30T20:45
- Branch: feat/issue-531-operator-review-workflow-for-ambiguous-vehicle-ide
- Effort guidance: standard
- Model guidance: sonnet

## Phase Usage

| Phase | Agent role/index | Provider | Model | Input tokens | Output tokens | Cache read tokens | Cache write tokens | Tool calls | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| run-sprint | orchestrator/0 | n/a | n/a | unavailable | unavailable | unavailable | unavailable | deterministic CLI | Prepared worktree and context artifacts. |
| implementation | worker/1 | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | unavailable | Added `PrismaVehicleIdentityDecisionRepository` with `listCandidates`, `approve`, `reject`, `split`, `undoSplit` methods; `adminVehicleIdentityRoutes` with 5 endpoints under `/admin/vehicle-identity/`; 16 route tests; wired into `app.ts` and `repositories/index.ts`. |
| review | reviewer/1 | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | unavailable | Roles: reviewer.md, qa.md, performance.md. Verdict REVISION_NEEDED: yes; 3 findings: (1) approve not transactional allowing concurrent duplicate Vehicle creation; (2) split accepting non-verified decisions; (3) missing test for split on non-verified state. |
| fix | worker/1 | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | unavailable | Wrapped approve() in db.$transaction(); widened idempotency guard; added InvalidStateError + 422 guard in split(); added 2 new tests. All 449 API tests passing. |

---

# Usage Report: Issue #535

## Metadata

- Sprint run: run-sprint/2026-07-01T06:48
- Branch: fix/issue-535-run-sprint-silently-drops-extra-issue-args-and-wor
- Effort guidance: high
- Model guidance: sonnet

## Phase Usage

| Phase | Agent role/index | Provider | Model | Input tokens | Output tokens | Cache read tokens | Cache write tokens | Tool calls | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| run-sprint | orchestrator/0 | n/a | n/a | unavailable | unavailable | unavailable | unavailable | deterministic CLI | Prepared worktree and context artifacts. |
| implementation | worker/1 | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | unavailable | Added extra-args guard in index.ts `run-sprint` case (CliError when args.length > 1); updated usage string and SKILL.md docs; added CRITICAL anti-pattern warning to worker.md step 6; added subprocess tests to run-sprint.test.ts covering dispatch layer. 3 commits, 199 tests passing. |
| review | reviewer/1 | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | unavailable | Reviewer backgrounded (ironic given the fix subject) — test suite used as fallback gate. Verdict: REVISION_NEEDED: no. |

---

# Usage Report: Issue #555

## Metadata

- Sprint run: run-sprint/2026-07-02T00:11
- Branch: feat/issue-555-ollama-powered-explain-error-button-on-failed-pipe
- Effort guidance: standard
- Model guidance: sonnet

## Phase Usage

| Phase | Agent role/index | Provider | Model | Input tokens | Output tokens | Cache read tokens | Cache write tokens | Tool calls | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| run-sprint | orchestrator/0 | n/a | n/a | unavailable | unavailable | unavailable | unavailable | deterministic CLI | Prepared worktree and context artifacts; #554 branch was pre-merged (fast-forward) into this worktree's branch. |
| implementation | worker/1 | Anthropic | Claude Sonnet 5 | unavailable | unavailable | unavailable | unavailable | unavailable | Added `POST /admin/ai/explain-error` in `apps/api/src/routes/admin-ai.ts` (prompt scoped to explanation/triage, forbids code-fix suggestions, 30s server-side Ollama timeout, queue-name allowlist validation); extended `GET /admin/sources/:id/pipeline` in `admin.ts` with `latestFailedJobId` per stage (source-scoped only); added "Explain this error" button + AI-labeled explanation panel to `SourcePipelineClient.tsx` with a 35s client-side `AbortSignal.timeout`; added `MockQueueAdapter.markFailed` test helper in `packages/queue`; updated `docs/api-routes.md`. Cherry-picked pre-existing `4b61cc1` (unrelated tsc fix on the #554 branch not carried over by the fast-forward merge) to keep typecheck green. |
| review | reviewer/1 | Anthropic | Claude Sonnet 4.6 (subagent) | 49612 (subagent total) | unavailable | unavailable | unavailable | 13 | Reviewer + QA combined role. Verdict REVISION_NEEDED: yes; 1 CRITICAL (explain-error accepted an unvalidated queue name, allowing arbitrary BullMQ queue instantiation via `queueFactory.createQueue` — fixed with a `KNOWN_QUEUE_NAMES` allowlist check returning 404, plus a regression test asserting `createQueue` is never called for an unknown queue), 2 WARNINGs (linear failed-job scan instead of direct `getJob` — accepted, matches existing `admin.ts` pattern at current scale; missing ownership re-check — mitigated by the new allowlist), 2 SUGGESTIONs (client/server timeout duplication vs. the new `#552` `fetch-with-timeout.ts` helper — left as-is since only the API is in scope for #555; untested 502 Ollama-error branch — fixed by adding that test). All AC verified end-to-end by the reviewer. |
| fix | worker/1 | Anthropic | Claude Sonnet 5 | unavailable | unavailable | unavailable | unavailable | unavailable | Applied the CRITICAL fix (queue allowlist) plus added 404-unknown-queue and 502-Ollama-error tests (918 API tests passing, up from 914); updated `docs/api-routes.md` to document the 404 case; re-ran full repo-wide typecheck/lint/build/test — all green. |

---

# Usage Report: Issue #565

## Metadata

- Sprint run: run-sprint/2026-07-02T06:25
- Branch: feat/issue-565-make-discover-the-home-page-and-add-bookmarkable-r
- Effort guidance: standard
- Model guidance: sonnet

## Phase Usage

| Phase | Agent role/index | Provider | Model | Input tokens | Output tokens | Cache read tokens | Cache write tokens | Tool calls | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| run-sprint | orchestrator/0 | n/a | n/a | unavailable | unavailable | unavailable | unavailable | deterministic CLI | Created issue #565, prepared the feature branch/worktree, and generated issue context. |
| implementation | worker/1 | Anthropic | Claude Sonnet | unavailable | unavailable | unavailable | unavailable | unavailable | Added shared bookmarkable results URL behavior, localized/fallback results routes, Discover at locale roots, personalized result summaries, query-preserving sort/pagination/filter controls, translations, and 6 focused route/URL tests. |
| review | worker/1 | Anthropic | Claude Sonnet | unavailable | unavailable | unavailable | unavailable | unavailable | Foreground self-review used reviewer, QA, accessibility, and docs-accuracy roles. Fixed 4 accessibility warnings covering touch targets, conflicting hidden/focusable SVG semantics, overridden button roles, and reduced motion. Verdict: REVISION_NEEDED: no. |
| validation | worker/1 | Anthropic | Claude Sonnet | unavailable | unavailable | unavailable | unavailable | unavailable | Full web suite: 461/461 tests; web TypeScript and scoped ESLint passed; webpack production build compiled, typechecked, generated 11/11 pages, and emitted both results routes. Affected Turbo orchestration was interrupted after isolated-worktree pnpm tasks stalled; equivalent direct checks passed. |

Token, cache, and tool-call counters are unavailable in this runtime.
