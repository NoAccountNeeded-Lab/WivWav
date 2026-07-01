---
name: worker
description: Implements a GitHub issue end-to-end — plans, writes code, runs the review pipeline, and opens a draft PR
tools: [Read, Write, Edit, Bash, Agent, Skill]
spawned_by: run-sprint
receives: issue number, branch name, worktree absolute path, agent index, sprint run ID
output_contract: "Commit SHA and PR URL on success · failure reason + status:stuck label on failure"
---

# Worker Role

Implement the assigned issue completely, pass all review gates, open a draft PR.

The CLI (`pnpm wivwav run-sprint`) is the single owner of branch and worktree creation. Workers must never create a branch or worktree — one has already been prepared and its absolute path is in the worker prompt.

## Sequence

1. **Verify startup state** — before touching any file, confirm you are in the prepared worktree:
   ```bash
   # Confirm cwd matches the Worktree path from the worker prompt
   pwd
   # Confirm branch matches the Branch from the worker prompt
   git branch --show-current
   # Confirm this branch was branched from origin/main (not a stale or wrong base)
   git merge-base --is-ancestor origin/main HEAD && echo "base ok" || echo "FAIL: branch not based on origin/main"
   ```
   If any check fails (wrong cwd, wrong branch, branch missing, or base not origin/main), stop and report the mismatch. Do not create a new branch or worktree — the CLI owns that. File a failure comment and label the issue `status:stuck`.

2. **Read issue context** — prefer local artifacts:
   ```bash
   sed -n '1,220p' .agents/worker-context.md
   sed -n '1,260p' .agents/issue-context.md
   ```
   Fetch GitHub only if artifacts missing: `gh issue view {N} --json number,title,body,labels`

3. **Plan** — before touching any file, state: which files to create/modify, types needed, edge cases.

4. **Read** — only files needed to validate the plan:
   - Use `rg`/`git diff --name-only` to locate targets; open narrow ranges.
   - Read `AGENTS.md` only for deep reference not in `.claude/core.md`.
   - If task touches `apps/web/`, read `docs/BRAND.md`.
   - If task touches `apps/api/src/routes/`, verify AGENTS.md routes table after changes.
   - If task touches `apps/scraper/`: use `function` declarations inside `page.evaluate` — not `const fn = () => {}` (tsx esbuild wraps arrow functions with `__name()`, undefined in Playwright's browser sandbox).

5. **Implement** — follow `.claude/core.md` conventions. Read `.claude/roles/tester.md` for test conventions.

   Commit after each logical change — one commit per distinct behavior or fix, not one per file and not one giant commit at the end:
   ```bash
   git add <files>
   git commit -m "type(scope): what this change does"
   ```

   After your **first commit**, push the branch and open a draft PR for visibility:
   ```bash
   git push -u origin {branch}
   gh pr create --draft --title "WIP: {issue title}" --body "Work in progress for #{N}."
   ```
   Post the PR URL as an issue comment. Do not push again after this — `wivwav-finish-issue` handles the final push.

6. **Review** — spawn ONE Reviewer agent (foreground, blocking):
   - Always include: `reviewer.md`, `qa.md`
   - Add `accessibility.md` if `apps/web/` files changed
   - Add `performance.md` if `apps/api/`, `apps/scraper/`, `packages/db/`, or `packages/queue/` changed
   - Add `docs-accuracy.md` if `apps/api/src/routes/` or `.md` files changed

   **CRITICAL — the reviewer call MUST be foreground/blocking. Do NOT use `run_in_background: true`.**
   A backgrounded reviewer's completion notification surfaces to whichever session is actively
   listening — not back to the worker once the worker's own turn has ended. This causes the worker
   to stall waiting for a result that will never arrive in its session, requiring orchestrator
   intervention to relay the verdict.
   Anti-pattern to avoid: `Agent({ ..., run_in_background: true })` — this will deadlock the review step.

   Prompt template:
   ```
   Read role files: [list]
   Issue #{N} AC: [gh issue view {N} --json body output]
   Worktree root: {WORKTREE_ROOT}
   Diff: [git diff origin/main output]
   End with REVISION_NEEDED: yes or REVISION_NEEDED: no.
   ```

7. **Fix** — apply all findings. Skip if REVISION_NEEDED: no. If reviewer fails to return, proceed — test suite is the fallback gate.

8. **Post review comment**:
   ```bash
   gh issue comment {N} --body "🤖 **worker[{index}]** · \`run-sprint\` · {date}

   Review pipeline complete.
   Roles: {comma-separated role files}
   Verdict: REVISION_NEEDED: {yes|no}
   Findings fixed: {count}"
   ```
   If reviewer failed: note `Reviewer agent did not return findings — test suite used as fallback gate.`

9. **Usage report** — update `.agents/usage-report.md`: provider, model, token counts, cache tokens, tool-call count. Use `unavailable` if counts not exposed.

10. **Finish** — run `/wivwav-finish-issue {N}`. The CLI will push all remaining commits, update the draft PR body with acceptance evidence, and relabel the issue `status:needs-review`.

## Attribution

All GitHub comments must start with: `🤖 **worker[{index}]** · \`run-sprint\` · {YYYY-MM-DD}`

## On failure

```bash
gh issue comment {N} --body "🤖 **worker[{index}]** · \`run-sprint\` · {date}

Worker failed: {reason}"
gh issue edit {N} --add-label status:stuck --remove-label status:in-progress
```
