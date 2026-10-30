# Read First: Homepage, Discover, and Results Redesign Handoff

**Last updated:** 2026-10-30  
**Overall state:** In progress. Nothing has been pushed, merged, deployed, or published.

This is the restart note for the next agent. Read this first, then read the governing instructions and [the implementation plan](home-discover-results-redesign.md). The plan remains the source of product requirements; this file records current execution state and blockers.

## Governing instructions

Before continuing, read `/Users/matt/.agents/AGENTS.md`, the repository `AGENTS.md`, `.claude/core.md`, and the local worker/role instructions required by the selected issue. Follow the SDLC CLI issue workflow; use GitHub as the status source. Do not bypass issue dependencies, alter unrelated work, or push/merge/deploy without the user's confirmation. Read `docs/BRAND.md` before web UI changes. For web accessibility, follow `.agents/skills/wav-a11y-audit/SKILL.md`; it says to reuse an already-running `make dev` server and stop if one is unavailable.

## Current issue state

| Issue | GitHub state | Local branch / worktree | Evidence and remaining work |
| --- | --- | --- | --- |
| [#1231 parent](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1231) | Open | Current root branch below | Progress and assignment notes have been posted. |
| [#1232 baseline](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1232) | Open, `status:needs-review` | `chore/issue-1232-baseline-redesign-data-search-memory` at repository root | Documentation, data audit, integrated preview, and reproducible measurements are committed locally. Focused docs and QA reviews approved. No product behavior changed. |
| [#1233 search filters](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1233) | Open, `status:stuck` | `feat/issue-1233-add-wav-shopping-filters-with-safe-index-rollout` at `.claude/worktrees/issue-1233-featsearch-add-wav-shopping-filters-with-safe-inde` | Six local commits; code, full repository checks, focused suites, and blocking review passed. Built-container E2E failed before tests due to Docker `ENOSPC` during Prisma generation. Full app runtime accessibility and production index/cache cutover remain unverified. See the issue's blocker comment and its acceptance evidence/runbook in that worktree. |
| [#1235 slider stability](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1235) | Open, `status:needs-review` | `fix/issue-1235-keep-range-sliders-stable-through-delayed-navigati` at `.claude/worktrees/issue-1235-fixweb-keep-range-sliders-stable-through-delayed-n` | Local commit `315b664a`; 29 focused tests, ESLint, TypeScript, and code review passed. Live delayed-navigation browser reproduction and runtime axe scan remain unverified because no approved dev server is running. See the issue evidence comment. |

Other redesign issues remain open/ready. Per the plan, #1234 and later work that depends on #1233 must wait until the search-filter dependency is unblocked. #1235 is independent and has reached needs-review.

## Worktree and commit facts

- Root worktree is on `chore/issue-1232-baseline-redesign-data-search-memory`, based on latest `origin/main` captured at `59dd9ab9668814c82a44ba189ae805ae3306ad3d`.
- Root branch contains the #1232 docs/evidence commits and local plan synchronization commits, most recently `1a65a243` before this handoff file. It is not pushed.
- #1233 commits, in order: `ecd4c2e9`, `5d49eb2d`, `4ff61258`, `366a41e4`, `03bda45b`, `af60534a`.
- #1235 commit: `315b664a`.
- Do not cherry-pick or combine branches casually. Preserve issue-scoped commit history and verify each prepared worktree before editing.
- `pnpm wivwav run-sprint` prepared both #1233 and #1235. It printed `fatal: Needed a single revision` during setup but still created each branch/worktree, claimed the issue, and emitted worker context. Verify current state before taking further action.

## Verification already collected

**#1233:** typecheck 30/30, lint 21/21, production build 18/18, full test 27/27. Relevant suites: API 1,550, web 633, types 285, search 62. Blocking review ended with `REVISION_NEEDED: no`. Docker E2E did not reach browser tests: Prisma generation failed with `ENOSPC` while unlinking a generated file. The last log was `/private/tmp/wivwav-1233-e2e.log` (temporary; it may no longer exist).

**#1235:** 29 focused Vitest tests, ESLint, `tsc --noEmit -p apps/web/tsconfig.json`, and `git diff --check` passed. Review found no remaining code findings. Live route/browser and runtime accessibility checks were not run.

**#1232 baseline:** Playwright Chromium 153.0.8010.12, three Discover→Results→Back cycles, seven samples. Approximate JS heap measured 15.2 MB in each sample; an earlier exploratory run read 11.2 MB, so values varied between runs. Discover/Results made 5/4 facet requests and had 580/1,216 DOM elements. Full samples and screenshots are in `docs/plans/baseline-captures-2026-10-30/`; repeatable script is `e2e/scripts/measure-redesign-baseline.mjs`. Do not describe this as proof of no leaks or as a measured improvement.

## Blockers and limits

1. **Docker storage:** at the last read-only inspection, the host data volume was 99% full with 5.3 GiB available; Docker reported 5.25 GB reclaimable volumes, but many containers and volumes were active/shared. No Docker resources were pruned or removed. Do not clean shared Docker state without an explicit, safe inventory and authorization. Once storage is available, rerun `pnpm test:e2e` in the #1233 worktree.
2. **Runtime accessibility/browser evidence:** the accessibility skill says not to start a second server and to stop if its `make dev` server is not already running. None is currently running. An accidental shell substitution briefly launched root-worktree `make dev`; those Next servers were stopped and ports 4000/4002 verified closed. Pre-existing Docker containers were left untouched. Do not claim a runtime scan or use a different worktree's app as evidence.
3. **No release actions:** none of the issue branches has been pushed; no PR was opened. The user explicitly required confirmation before publishing, merging, or deploying.

## Preserve these pre-existing untracked files

The following user files/directories were present before implementation and must remain untouched:

- `.claude/plans/`
- `apps/ops/AGENTS.md`
- `apps/ops/CLAUDE.md`
- `docs/plans/secure-ai-ops-mvp.md`
- `docs/plans/secure-ai-ops-handoff-2026-10-30.md`

At last root-worktree check, these remained untracked and there were no modified tracked files. Recheck `git status` before editing or staging.

## Recommended resume order

1. Check issue labels, branch/worktree state, available Docker storage, and `git status` in all three worktrees.
2. **Recommended:** once safe Docker capacity is available, rerun `pnpm test:e2e` on #1233. Resolve any findings, update the issue and plan, and only then unblock dependent redesign issues.
3. Complete #1235's browser reproduction/runtime axe evidence only if the approved dev server is already available under the audit skill's rules.
4. Continue issue-by-issue in the plan's dependency order. Keep changes local until the user confirms publishing.

Do not mark the redesign complete until all plan acceptance criteria and final repository verification are actually evidenced, and all skipped checks, rollout/rollback notes, and remaining linked work are recorded.
