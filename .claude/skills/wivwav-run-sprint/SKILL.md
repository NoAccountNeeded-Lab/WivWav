---
description: Run a development sprint by preparing ready issues with the SDLC CLI, then spawning Claude worker agents in the prepared worktrees. Supports single-issue, sequential, and parallel modes. Pass an issue number to target one issue; --limit N to cap sequential runs; --parallel N (or -p N) to run N issues concurrently.
argument-hint: "[issue-number] [--limit N] [--parallel N]"
---

# Run Sprint

Use this skill for sprint orchestration. The SDLC CLI is the source of truth for issue selection, readiness checks, labels, branch names, worktree setup, and recovery state.

## 1. Prepare sprint work

Run the CLI from the repository root, passing `$ARGUMENTS` through exactly:

```bash
pnpm wivwav run-sprint $ARGUMENTS
```

If the command fails, stop and report the CLI error. Do not manually recreate its GitHub label, branch, or worktree logic.

The CLI will:
- select the explicit issue, or validate ready issues as read-only candidates for sequential/parallel mode
- verify issue state and acceptance criteria (read-only; no mutations until claim time)
- claim lazily: in sequential mode, move exactly ONE issue to `status:in-progress` per invocation; in parallel mode, claim up to the configured concurrency window
- create one isolated worktree per claimed issue (unclaimed candidates are left without worktrees)
- write `.agents/` context artifacts into each claimed worktree
- write `/tmp/wivwav-{N}.md` recovery state for each claimed issue
- print worker instructions for each claimed issue

## 2. Spawn workers from CLI output

For each worker instruction block printed by the CLI:

- Use the listed `Worktree`, `Branch`, `Agent-Index`, and `Sprint-Run`.
- Spawn one worker agent with `model: "sonnet"`. Do not set `isolation: "worktree"` — the CLI already created a dedicated worktree for each issue; a second isolation setting would create a nested/duplicate worktree.
- In sequential mode, the CLI claims one issue per invocation. After the worker completes (success or failure), re-run the CLI to claim and prepare the next issue. Run each worker foreground/blocking.
- In parallel mode, spawn all listed workers in one message with `run_in_background: true`.

The worker prompt is the instruction block printed by the CLI. Do not add the full issue body to the spawn prompt; the worker reads `.agents/worker-context.md` and `.agents/issue-context.md` from the prepared worktree before fetching live issue details.

## 3. Handle completions

As workers complete:

- Success: post an issue comment with draft PR URL, commit SHA, and sprint ID; update `/tmp/wivwav-{N}.md` to `Status: success` and add the PR URL.
- Failure: label the issue `status:stuck`, post a failure comment, and update `/tmp/wivwav-{N}.md` to `Status: stuck`.
- Clean up each completed worktree with `git worktree remove --force {worktree}` followed by `git worktree prune`.
- Preserve the worker's `.agents/usage-report.md` contents in the PR or issue evidence when reviewing sprint cost.

Never cancel other running workers because one failed. A partial success is still a valid sprint run.

## 4. Final summary

Report:
- mode used: single, sequential, or parallel
- per-issue outcome: draft PR URL or stuck reason
- count of issues still labeled `status:ready`
