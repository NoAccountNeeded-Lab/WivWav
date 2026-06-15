---
description: Run a development sprint by working on ready issues. Supports single-issue, sequential (drain queue), and parallel (concurrent workers) modes. Pass an issue number to target one issue; --limit N to cap sequential runs; --parallel N (or -p N) to run N issues concurrently.
argument-hint: "[issue-number] [--limit N] [--parallel N]"
---

# Run Sprint

Works on ready issues using Claude Code sub-agents, each in an isolated git worktree.

**Modes:**
- **Single** — `[issue-number]`: run exactly one specified issue.
- **Sequential** (default): drain all `status:ready` issues one at a time; add `--limit N` to cap how many.
- **Parallel** — `--parallel N` (alias `-p N`): spawn up to N issues as concurrent background agents in one shot.

This command does not run multiple issues concurrently in sequential mode. True parallel orchestration uses `run_in_background: true` and requires unique agent indexes per worker.

---

## Steps

### 1. Parse arguments

From `$ARGUMENTS` extract:
- `ISSUE_NUMBER` — bare integer if present, else empty
- `LIMIT` — value after `--limit` if present; default `0` (unlimited) for sequential mode
- `PARALLEL` — value after `--parallel` or `-p` if present; `0` means sequential

If both an issue number and `--parallel` are given, ignore `--parallel` and run single-issue mode.

### 2. Generate a Sprint-Run ID

```bash
SPRINT_RUN_ID="run-sprint/$(date -u +%Y-%m-%dT%H:%M)"
```

The Sprint-Run ID includes `T%H:%M` for uniqueness across multiple runs on the same day. Issue comments use `%Y-%m-%d` (date only) for human readability.

### 3. Prune stale git metadata

```bash
git worktree prune
git worktree list
```

Do **not** remove worktree directories blindly. Only remove a specific `.claude/worktrees/...` directory if it is clearly stale and confirmed not used by an active worker.

### 4. Select target issues

- If `ISSUE_NUMBER` is set: use only that issue (single mode).
- Otherwise list ready issues:

```bash
gh issue list --label status:ready --json number,title --limit 20
```

If none, report "No issues labeled status:ready. Nothing to do." and stop.

Apply mode caps:
- **Single**: take that issue only.
- **Sequential**: take up to `LIMIT` issues (all if `LIMIT=0`), ordered by issue number ascending.
- **Parallel**: take up to `PARALLEL` issues; report any extras as queued for the next sprint. `--limit` is ignored when `--parallel` is set — `PARALLEL` itself is the cap.

### 5. Readiness pre-flight for each selected issue

For each candidate:

```bash
gh issue view {N} --json number,title,body,labels,state
```

Skip (do not process) if:
- The issue is not open.
- The issue is already labeled `status:in-progress`.
- The issue is not labeled `status:ready` and was not explicitly supplied by the user.

Check the body for acceptance criteria (case-insensitive match on any of):
- `acceptance criteria`
- `done when`
- `## ac`
- A non-empty checklist (`- [ ]`)

If none are present, **do not spawn a worker**:
- Post comment: "🤖 **orchestrator[0]** · `run-sprint` · $(date -u +%Y-%m-%d)\n\nIssue is missing acceptance criteria. Add them before this issue can be picked up by a sprint worker."
- Remove `status:ready`, add `status:stuck`.
- Report to the user and exclude this issue from the run.

If no issues survive pre-flight, stop.

### 6. Derive branch names

For each issue that passed pre-flight, derive its branch name using prefix and slug rules from `.claude/core.md` (feat/fix/docs/chore + issue-N-slug).

### 7. Label all selected issues in-progress and post start comments

For each issue:
```bash
gh issue edit {N} --add-label status:in-progress --remove-label status:ready
gh issue comment {N} --body "🤖 **orchestrator[0]** · \`run-sprint\` · $(date -u +%Y-%m-%d)

Sprint worker starting. Branch: {branch-name} · Sprint: {SPRINT_RUN_ID}"
```

---

## Sequential mode (PARALLEL=0)

### 8-seq. Loop through issues one at a time

Each Agent call is **foreground (blocking)** — wait for the result before proceeding to the next issue.

For each issue in order, assign agent index **1** and spawn a worker with `isolation: "worktree"`:

**Worker prompt** (fill in N, branch-name, SPRINT_RUN_ID):

---
Read `.claude/core.md` and `.claude/roles/worker.md` before doing anything else.
Keep startup context lean: do not read `AGENTS.md`, package manifests, or broad directory listings unless your plan identifies a specific need for them.

You are implementing issue #{N}.

First fetch the issue details:
`gh issue view {N} --json number,title,body,labels`

Before reading source files, use the fetched issue details to write a scoped plan that names the likely files and the evidence you need from each one.

Your branch: {branch-name}
Agent-Role: worker
Agent-Index: 1
Sprint-Run: {SPRINT_RUN_ID}

---

If the Agent call fails to spawn:
```bash
gh issue edit {N} --remove-label status:in-progress --add-label status:stuck
gh issue comment {N} --body "🤖 **orchestrator[0]** · \`run-sprint\` · $(date -u +%Y-%m-%d)

Worker failed to start: {error}. Labeled status:stuck for triage."
```

After each worker completes, post a summary comment:
- Success:
  ```
  🤖 **orchestrator[0]** · `run-sprint` · $(date -u +%Y-%m-%d)

  Draft PR opened: {PR URL}. Commit: {SHA}. Sprint: {SPRINT_RUN_ID}
  ```
- Failure:
  ```
  🤖 **orchestrator[0]** · `run-sprint` · $(date -u +%Y-%m-%d)

  Worker could not complete this issue: {reason}. Labeled status:stuck for triage.
  ```

Clean up the worktree for that issue before moving to the next:
```bash
git worktree remove --force .claude/worktrees/{worktree-dir}
git worktree prune
```

If a worker fails, label the issue `status:stuck` and continue to the next issue. Proceed until the list is exhausted or `LIMIT` is reached.

---

## Parallel mode (PARALLEL > 0)

### 8-par. Spawn all workers in a single message as background agents

Assign each issue a unique agent index starting at 1 (first issue → index 1, second → index 2, …).

Spawn **all agents in one message** using `run_in_background: true` and `isolation: "worktree"` on each Agent call.

**Worker prompt** (fill in N, branch-name, SPRINT_RUN_ID, AGENT_INDEX):

---
Read `.claude/core.md` and `.claude/roles/worker.md` before doing anything else.
Keep startup context lean: do not read `AGENTS.md`, package manifests, or broad directory listings unless your plan identifies a specific need for them.

You are implementing issue #{N}.

First fetch the issue details:
`gh issue view {N} --json number,title,body,labels`

Before reading source files, use the fetched issue details to write a scoped plan that names the likely files and the evidence you need from each one.

Your branch: {branch-name}
Agent-Role: worker
Agent-Index: {AGENT_INDEX}
Sprint-Run: {SPRINT_RUN_ID}

---

If any Agent call fails to spawn immediately:
```bash
gh issue edit {N} --remove-label status:in-progress --add-label status:stuck
gh issue comment {N} --body "🤖 **orchestrator[0]** · \`run-sprint\` · $(date -u +%Y-%m-%d)

Worker failed to start: {error}. Labeled status:stuck for triage."
```

### 9-par. Handle completions as they arrive

The harness notifies you when each background agent finishes. As each one completes, **immediately** post its summary comment — do not wait for all workers before posting. Accumulate each result as notifications arrive; post the final sprint summary (section 9) only after the last worker finishes.

- Success:
  ```
  🤖 **orchestrator[0]** · `run-sprint` · $(date -u +%Y-%m-%d)

  Draft PR opened: {PR URL}. Commit: {SHA}. Sprint: {SPRINT_RUN_ID}
  ```
- Failure:
  ```
  🤖 **orchestrator[0]** · `run-sprint` · $(date -u +%Y-%m-%d)

  Worker could not complete this issue: {reason}. Labeled status:stuck for triage.
  ```

Clean up each worktree as its worker finishes — do not wait for all workers:
```bash
git worktree remove --force .claude/worktrees/{worktree-dir}
git worktree prune
```

A partial success (some workers succeed, some fail) is still a valid sprint run. Never cancel running workers because one failed.

---

## 9. Final sprint summary (all modes)

In sequential mode, all outcomes are known before this step. In parallel mode, post this summary only after the last background worker completes (you accumulate outcomes from completion notifications in section 9-par).

Report to the user:
- Mode used (single / sequential / parallel)
- Per-issue outcome: issue number → draft PR URL or stuck
- Count of issues remaining with `status:ready` queued for the next sprint
