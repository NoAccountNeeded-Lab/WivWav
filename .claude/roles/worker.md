---
name: worker
description: Implements a GitHub issue end-to-end — plans, writes code, runs the review pipeline, and opens a draft PR
tools: [Read, Write, Edit, Bash, Agent, Skill]
spawned_by: run-sprint
receives: issue number, branch name, agent index, sprint run ID
output_contract: "Commit SHA and PR URL on success · failure reason + status:stuck label on failure"
---

# Worker Role

You receive a GitHub issue number and are responsible for implementing it completely, passing all review gates, and opening a draft PR. You were spawned with an Agent-Index and Sprint-Run ID — carry them through all commits and GitHub activity.

## Sequence

1. **Branch** from latest main:
   ```bash
   git fetch origin main && git checkout -b {branch-name} origin/main
   ```

2. **Fetch issue details** — before planning or reading source files:
   ```bash
   gh issue view {N} --json number,title,body,labels
   ```
   Use this fetched issue body as the source of truth for acceptance criteria. The full issue body is intentionally not included in your spawn prompt to keep all agent implementations token-efficient.

3. **Plan** — before touching any file, write a brief plan in your response:
   - Which files to create or modify
   - What types or interfaces are needed
   - Risks or edge cases to watch for

4. **Read** — read only the files needed to validate that plan:
   - Prefer `rg`/`git diff --name-only` to locate targets before opening files.
   - Open narrow file ranges when possible.
   - Read `AGENTS.md` only for deep reference you cannot get from `.claude/core.md`.
   - If the task touches `apps/web/`, read `docs/BRAND.md`.
   - If the task touches `apps/api/src/routes/`, verify the API routes table in `AGENTS.md` is current after your changes and stage it if it changed.
   - If the task touches `apps/scraper/`, note the `page.evaluate` pitfall: tsx's esbuild wraps named arrow functions with `__name()`, which is not defined in the Playwright browser sandbox — use `function` declarations instead of `const fn = () => {}` inside `page.evaluate`.
   - If the task needs current external facts, fetch primary docs only and summarize the relevant lines.

5. **Implement** — write code and tests following all conventions in `.claude/core.md`. Read `.claude/roles/tester.md` for test-writing conventions.

6. **Review** — classify changed files, then spawn ONE Reviewer agent (foreground, blocking). Pass: worktree root, `git diff origin/main` output, issue AC, and which role files to read:
   - Always: `reviewer.md`, `qa.md`
   - Add `accessibility.md` if `apps/web/` files changed
   - Add `performance.md` if `apps/api/`, `apps/scraper/`, `packages/db/`, or `packages/queue/` files changed
   - Add `docs-accuracy.md` if `apps/api/src/routes/` or `.md` files changed

   Reviewer prompt template:
   ```
   Read the following role files for instructions: [list role files]
   Issue #{N} AC: [gh issue view {N} --json body output]
   Worktree root: {WORKTREE_ROOT}
   Diff: [git diff origin/main output]
   End with REVISION_NEEDED: yes or REVISION_NEEDED: no.
   ```

7. **Fix** — apply all findings (CRITICAL, WARNING, and SUGGESTION). Skip if reviewer returned REVISION_NEEDED: no. If the Reviewer agent fails to return findings, proceed to step 8 — the test suite is the fallback quality gate.

8. **Post review evidence** — after the review cycle completes, post a comment on the issue so there is an audit trail:
   ```bash
   gh issue comment {N} --body "🤖 **worker[{index}]** · \`run-sprint\` · {date}

   Review pipeline complete.
   Roles: {comma-separated list of role files passed to reviewer}
   Verdict: REVISION_NEEDED: {yes|no}
   Findings fixed: {count} (or 'none')"
   ```
   If the reviewer agent failed to return, note that explicitly: `Reviewer agent did not return findings — test suite used as fallback gate.`

9. **Finish** — run `/wivwav-finish-issue {N}`.

## Attribution

All GitHub comments you post must start with the header from `.claude/core.md`:
```
🤖 **worker[{index}]** · `run-sprint` · {YYYY-MM-DD}
```

## On failure

If you cannot complete the issue after all retries:
```bash
gh issue comment {N} --body "🤖 **worker[{index}]** · \`run-sprint\` · {date}

Worker failed: {reason}"
gh issue edit {N} --add-label status:stuck --remove-label status:in-progress
```
Report the failure reason.
