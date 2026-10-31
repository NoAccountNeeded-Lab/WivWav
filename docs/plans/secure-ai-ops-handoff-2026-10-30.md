# WivWav operations diagnosis handoff

Updated: 2026-10-30

## Objective

Pick up the investigation into recent site/job failures, improve the secure AI ops MVP plan with the diagnostic capabilities these incidents exposed, then fix any still-current product issue through the WivWav issue workflow.

## Current state

- The plan at [`secure-ai-ops-mvp.md`](./secure-ai-ops-mvp.md) has been updated with bounded failed-job diagnosis requirements and sanitized observations from local Docker/Mac Mini logs. It remains **planning**; no implementation has started.
- No code was changed, tested, committed, pushed, or opened as a PR during this investigation.
- The checkout was on `chore/issue-1232-baseline-redesign-data-search-memory`, already 9 commits ahead of `origin/main` at the last check. Treat those commits as existing work; inspect ownership before any push.
- Existing untracked paths at last check: `.claude/plans/`, `apps/ops/AGENTS.md`, `apps/ops/CLAUDE.md`, and `docs/plans/`. Preserve them. `docs/plans/secure-ai-ops-mvp.md` was already untracked before it was edited in this session.
- `gh auth status` reports the saved `ClaudeWorkspace2026` token is invalid. Git previously read the public remote, but the most recent `git ls-remote` failed because `github.com` did not resolve. No issue writes or push were attempted.

## Evidence collected

Read-only logs and service checks were inspected on the local Docker host and `~/Projects/Server/macmini`.

- **Superior Van & Mobility:** historical `detail-extract` jobs repeatedly submitted 39/39 raw pages and got HTTP 500 from `/internal/scraper/detail-extract/submit`. Issue #1211 records the BullMQ-incompatible custom job ID cause and fix (commit `8034c956` uses a hash-safe ID). At the database check, Superior Van was active and all 39 raw pages were processed. Treat these as historical failures unless new logs show recurrence.
- **NHTSA recalls:** two historical upserts returned HTTP 400. The worker HTTP client retains response bodies, but failure logging kept only status/route/message, hiding field-level validation detail.
- **NHTSA complaints:** historical 503/timeout evidence was present.
- **BLVD:** a historical `/listings/mark-gone` request returned 500. BLVD was disabled at the database check; investigate separately only if it is re-enabled or a new failure reproduces.
- **MobilityVanSales:** a source-scrape worker timeout was observed historically.
- **eBay Motors:** credentials lookup returned 404 while the source was disabled; do not treat this alone as an active site issue.
- **Capacity refusals** were requeued, not final job failures.
- Failed BullMQ ZSET entries included old failures; retained failed-job counts are not the same as active backlog or current outage.
- The latest observed listing-index-poll failure used a stale Meilisearch IP (`192.168.0.215:7701`); current API configuration used `192.168.0.225:7701`, and API health reported Meilisearch up. The old address timed out when probed.
- MobilityWorks was `needs_remapping` with `Structure changed — AI remapping unavailable; operator intervention required`; its last scrape was Oct 16. This is the clearest active source-recovery candidate.
- Public `https://wivwav.com` followed its locale redirect to `/en` and returned 200. The Mini API health endpoint returned 200. An unauthenticated `/v1/listings` request returned 401, consistent with the API-key boundary, not evidence by itself of public-site failure.

These findings are time-bounded snapshots. Recheck live state before making changes; do not present historical logs as current incidents.

## Relevant issue and code context

- Open issue **#1209**, `discussion(scraper): restore MobilityWorks recovery for remote workers without AI remapping wiring`, has diagnosis-oriented acceptance criteria. It calls for capturing changed structure, assessing the current adapter against fixture/gold evidence, documenting the smallest supported recovery path, and verifying a repaired run or producing a scoped implementation follow-up. It is not an implementation-ready issue; do not mark it ready prematurely.
- Closed issue **#1211** documents the Superior Van job-ID fix. Verify it remains in the target branch before diagnosing any recurrence.
- MobilityWorks uses a custom adapter at `packages/scraper-sources/src/sources/mobilityworks.ts`; stored mappings may not govern its parser. The adapter extracts listing cards and checks a DOM signature. Related detail parser: `packages/scraper-sources/src/sources/mobilityworks-detail.ts`.
- Existing sanitized contract fixture: `packages/scraper-sources/src/sources/fixtures/contracts/mobilityworks-list-v1.html`; card gold data: `packages/scraper-sources/src/sources/fixtures/gold/mobilityworks-card.gold.json`.
- A prior inspection read MobilityWorks `robots.txt` with the project user agent: `/cgi-bin/` and `/wp-admin/` disallowed, crawl delay 10 seconds. The listing path appeared allowed. Avoid repeated live requests; prefer captured/sanitized fixtures and respect crawl delay if a fresh fetch is necessary.
- The MVP plan now requires bounded, sanitized job evidence: queue/job/correlation IDs, source/run IDs when available, attempt/time/status, safe API error code/message and validation issues, plus adjacent correlated logs. It explicitly excludes request bodies, credentials, raw seller HTML, and personal data; requires distinguishing validation, parser/source, server, dependency, capacity-requeue, and connectivity failures; and reporting missing/expired evidence instead of guessing.

## Recommended pickup sequence

1. Read `/Users/matt/.agents/AGENTS.md`, repository `AGENTS.md`, and the relevant investigation/scraper skills. Start with `git status --short --branch`; preserve the existing branch and all untracked work.
2. Re-establish network and GitHub CLI authentication. Verify `gh auth status` and `git ls-remote origin refs/heads/main` separately; Git and `gh` use distinct auth paths. Do not expose tokens in logs or messages.
3. Recheck current Docker/Mac Mini logs and database/service state, using read-only commands. Correlate only new failures with active jobs/backlog; note log-retention gaps. Do not infer a current outage from the historic counts above.
4. Re-read #1209 and verify its current state, acceptance criteria, labels, and any associated branch/PR. If MobilityWorks still needs a code fix, use an implementation-ready issue with explicit AC. Before edits, follow `pnpm wivwav start <issue>` (or the documented manual fallback only if the CLI is unavailable): issue status, latest `origin/main`, issue-scoped branch, and check-in comment are required.
5. For MobilityWorks, compare the current adapter/signature logic and captured sanitized DOM against the contract fixture and gold cases. Prefer reproducible fixture evidence. If live inspection is essential, use one controlled fetch within robots/crawl-delay limits and retain only sanitized structure evidence.
6. Fix only the confirmed active cause. For request/worker diagnostics, scope any work to an accepted issue and existing logging/diagnostic architecture. Do not introduce broad queue controls, retries, production crawls, mapping writes, or automatic remaps under the MVP plan.
7. Run only checks requested by the user or required by the accepted issue. Record exact commands, results, skipped checks, and current evidence in the issue/PR. Do not push the existing nine-commit-ahead branch without confirming those commits belong to the intended change.

## User-facing status at handoff

The MVP plan update is complete. Site/job remediation is not complete. The immediate technical lead is the MobilityWorks `needs_remapping` state; the historical Superior Van failure appears recovered. GitHub CLI auth and DNS were unavailable at the last check, and the current checkout contains unrelated existing work, so implementation/push must resume only after those conditions are verified.
