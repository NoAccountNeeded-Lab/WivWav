---
description: Prepare and run single, sequential, or parallel WivWav worker sprints
argument-hint: "[issue-number] [--limit N] [--parallel N]"
---

# Run sprint

The SDLC CLI owns issue selection, readiness, labels, branches, worktrees, context, and recovery state.

Run from repository root:

```bash
pnpm wivwav run-sprint $ARGUMENTS
```

On CLI failure: stop; report; do not recreate state manually.
Accept at most one explicit issue number.
For multiple ready issues, use `--parallel N`; for sequential candidates, use `--limit N`.
The CLI validates candidates before mutation; sequential mode claims one issue per invocation; parallel mode claims up to its concurrency.
Only claimed issues receive a worktree, `.agents/` context, `/tmp/wivwav-{N}.md` recovery state, and worker instructions.

For each printed block: use its `Worktree`, `Branch`, `Agent-Index`, and `Sprint-Run`; pass its provider-neutral `Model` value as the worker model; do not request additional worktree isolation.
Provider and subscription routing belongs to #465; do not add credentials or dispatch logic.
Sequential workers run foreground/blocking; after completion, rerun the CLI for the next issue.
Parallel workers start together with `run_in_background: true`.
Use the printed worker prompt; do not append the full issue body.

On success: comment draft PR URL, commit SHA, and sprint ID; set recovery state to `Status: success`; record PR URL.
On failure: set `status:stuck`; comment the reason; set recovery state to `Status: stuck`.
After each completion: preserve `.agents/usage-report.md` evidence; run `git worktree remove --force {worktree}` then `git worktree prune`.
Do not cancel other workers because one fails.

Final report: mode; outcome per issue; remaining `status:ready` count.
