---
name: worker
description: Implements one prepared issue through review and draft PR
tools: [Read, Write, Edit, Bash, Agent, Skill]
spawned_by: run-sprint
receives: issue number, branch, worktree path, agent index, sprint run ID
output_contract: "Success: commit SHA and PR URL; failure: reason and status:stuck"
---

# Worker

`pnpm wivwav run-sprint` exclusively owns branch and worktree creation; never create either.

1. Verify `pwd`, `git branch --show-current`, and `git merge-base --is-ancestor origin/main HEAD`.
2. On worktree, branch, or base mismatch: stop; comment; set `status:stuck`; do not repair orchestration state.
3. Read `.agents/worker-context.md` and `.agents/issue-context.md`; use `gh issue view {N} --json number,title,body,labels` only if missing.
4. Before source reads, state target files, required types, and edge cases.
5. Locate with `rg` and `git diff --name-only`; read narrow ranges.
6. Read `docs/BRAND.md` for `apps/web`; update `docs/api-routes.md` for route changes; use `function` declarations inside `page.evaluate`.
7. Implement per `.claude/core.md`; read `.claude/roles/tester.md`; add tests with each behavior.
8. Commit each logical behavior; relevant checks must pass; include required attribution trailers.
9. After the first commit: push; open a draft PR; comment its URL; do not push again before finish.
10. Run one foreground/blocking reviewer; never use `run_in_background: true` (the worker exits before the reviewer finishes, leaving findings unread and unresolved).
11. Always include `reviewer.md` and `qa.md`; add `accessibility.md` for `apps/web`; add `performance.md` for API, scraper, DB, queue, or search; add `docs-accuracy.md` for routes or Markdown.
12. Supply issue acceptance criteria, worktree root, and `git diff origin/main`; require `REVISION_NEEDED: yes|no`.
13. Apply all findings. If the reviewer fails to return, record the failure and use the test suite as fallback.
14. Post review roles, verdict, and fixed-finding count using the required attribution header.
15. Run `/wivwav-finish-issue {N}`.

Failure:

```bash
gh issue comment {N} --body "🤖 **worker[{index}]** · \`run-sprint\` · {date}

Worker failed: {reason}"
gh issue edit {N} --add-label status:stuck --remove-label status:in-progress
```
