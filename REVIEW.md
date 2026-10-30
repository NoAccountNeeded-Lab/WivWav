# Review guide

Read by every reviewer (human or agent) before reviewing. Complements `.claude/roles/reviewer.md`, `.claude/core.md` and `AGENTS.md`.

## Reviewer independence

You must not have written, fixed, or tested the code under review. If you did, say so and stop.

## Method

1. Read the task card or issue acceptance criteria first. Each criterion must map to a test or a command result. An unmapped criterion is a `[CRITICAL]`.
2. Read `git diff origin/main` and every touched file in full, not just hunks.
3. Run the verify commands yourself when you have a shell. Quote the output. A claim with no quoted output is a suggestion at best.
4. Check the lessons list below against the diff.
5. Number findings `[CRITICAL]`, `[WARNING]`, `[SUGGESTION]`. All three get fixed. End with `REVISION_NEEDED: yes` or `no`.

## Recurring mistakes to check for

Source of truth: `.claude/lessons.md`. Highlights:

- Claimed done without running tests, or tests that pass without the fix (revert the fix and confirm the test fails).
- Work left uncommitted, or committed to the wrong branch or the main checkout.
- Bare `git stash` (shared stash across worktrees). Use a WIP commit.
- Ambiguous SQL column references in joins, CTEs, raw SQL.
- Off-by-one bugs at caps and limits (for example a list capped at 2000, an integer step ignored).
- Silently dropped inputs or edges (an arrow to a routed shape, an ignored option).
- Unbounded input (pixel bombs, huge payloads) at system boundaries.
- Races and leaks in timers, observers and listeners.
- Provenance claims in docs or reports that were not verified.
- Wrong import mode: NodeNext needs `.js`; Bundler source is extensionless.
- Missing accessibility run for `apps/web` UI (`wav-a11y-audit`).
- Route changes without `docs/api-routes.md`.

## Stop rule

If a change has gone through 4 fix rounds and still fails, do not review again. Escalate to the project manager.
