---
description: Run the WivWav code review pipeline against actual changed files. Auto-detects change type and routes to the matching pipeline — only the relevant sub-agents run. Can be used before or after a PR is open.
argument-hint: "[issue-number]"
---

# WivWav Code Review

Classifies the changed files, routes to the matching named pipeline, and runs only the sub-agents that are relevant for that type of change. Each sub-agent reads its own role file in `.claude/roles/` for instructions.

---

## Step 1 — Identify changed files

Capture the worktree root first, then run all git commands relative to it:

```bash
WORKTREE_ROOT=$(git rev-parse --show-toplevel)
git -C "$WORKTREE_ROOT" diff --name-only HEAD
git -C "$WORKTREE_ROOT" diff --name-only --cached
git -C "$WORKTREE_ROOT" ls-files --others --exclude-standard
```

Combine all three. Exclude `.env` files, `node_modules`, `dist`, and generated Prisma output.

Keep `WORKTREE_ROOT` in scope — it is threaded through all git commands, sub-agent prompts, and verification commands in Steps 5 and 8.

---

## Step 2 — Classify the change type

Inspect the file list and assign a **primary type**. If multiple types apply, use the **mixed** pipeline.

| Type       | Files that trigger it                                              |
| ---------- | ------------------------------------------------------------------ |
| **web**    | any file under `apps/web/`                                         |
| **code**   | `.ts` or `.tsx` files outside `apps/web/`                         |
| **docs**   | `.md` files, `SKILL.md` files, `.claude/` instruction files       |
| **config** | `.json`, `.yaml`, `.yml`, `.sh`, `Dockerfile*`, `Makefile`        |
| **content**| files under `content/`, `blog/`, or `posts/` *(future use)*      |
| **mixed**  | files from more than one type above                               |

---

## Step 3 — Read shared context once

Before spawning any sub-agent, read `.claude/core.md` once in the orchestrator context and keep the exact Markdown content available as `{core-context}`.

Do not ask each sub-agent to read `.claude/core.md`. The core context is stable and shared across all review roles, so pass it into each sub-agent prompt as a quoted block. This applies to Claude Code sub-agents and any equivalent Codex, Gemini, Copilot, Cursor, Ollama, or other agent orchestration that mirrors this pipeline.

---

## Step 4 — Select model tier for sub-agents

Choose the model tier based on the detected change type. If your platform or provider supports per-agent model selection, apply the appropriate tier to every sub-agent spawned in this step. If it does not, use your default model throughout.

| Tier | When to use | Provider examples |
| ---- | ----------- | ----------------- |
| **lightweight** | `docs`, `config` pipelines — consistency and clarity checks, no deep reasoning needed | Claude Haiku · GPT-4o-mini · Gemini Flash · small Ollama model (≤7B) · Copilot fast mode |
| **standard** | `code`, `web`, `mixed` pipelines — type safety, logic bugs, security, accessibility | Claude Sonnet · GPT-4o · Gemini Pro · large Ollama model (≥13B) · Copilot standard mode |

This applies equally to Claude Code, Codex, Gemini, Copilot, Cursor, Ollama, and any other agent that runs this pipeline.

---

## Step 5 — Run the pipeline for the detected type

Jump to the matching section below. Each sub-agent prompt follows this template:

```
Project core context is already supplied below. Do not re-read `.claude/core.md`.

<core-context>
{core-context}
</core-context>

Read `.claude/roles/{role}.md` for your role instructions and output format.

Issue number: {N}
Your scoped file list: {files for this job}
Worktree root: {WORKTREE_ROOT}

All file reads, writes, and git commands must be scoped to this worktree root.
Use your Read tool to read each file before reviewing, using absolute paths under {WORKTREE_ROOT}.
Use Bash to run `git -C "{WORKTREE_ROOT}" diff origin/main -- {file}` to see what changed.
If you write test files, write them under {WORKTREE_ROOT} using absolute paths.
Follow the output format defined in your role file exactly.
```

---

### Pipeline: web

*Triggered when any `apps/web/` file changed.*

Spawn these sub-agents **in parallel**:

1. **reviewer** (`.claude/roles/reviewer.md`) — bugs, type safety, security, principles
2. **accessibility** (`.claude/roles/accessibility.md`) — WCAG 2.1 AA, keyboard, screen reader, touch targets, mobile
3. **tester** (`.claude/roles/tester.md`) — identify coverage gaps, write missing Vitest tests to disk
4. **qa** (`.claude/roles/qa.md`) — validate against acceptance criteria

For **qa**, also include: `gh issue view N --json title,body`
For **tester**, also include: "Write any missing tests directly to disk using your Write/Edit tools. All test file paths must be absolute paths under {WORKTREE_ROOT}."

---

### Pipeline: code

*Triggered when `.ts` / `.tsx` files outside `apps/web/` changed.*

Spawn in parallel:

1. **reviewer** (`.claude/roles/reviewer.md`) — bugs, type safety, security, principles
2. **tester** (`.claude/roles/tester.md`) — missing Vitest coverage, write tests to disk. All test file paths must be absolute paths under {WORKTREE_ROOT}.
3. **qa** (`.claude/roles/qa.md`) — acceptance criteria coverage
4. **docs-accuracy** (`.claude/roles/docs-accuracy.md`) — **only if** the changed file list includes any file under `apps/api/src/routes/`. Scope it to verifying the API routes table in `AGENTS.md` is current. Skip otherwise.

*No accessibility sub-agent — no user-facing UI changed.*

---

### Pipeline: docs

*Triggered when `.md`, `SKILL.md`, or `.claude/` instruction files changed.*

Spawn in parallel:

1. **reviewer** (`.claude/roles/reviewer.md`) — clarity, accuracy, internal consistency, contradictions
2. **docs-accuracy** (`.claude/roles/docs-accuracy.md`) — verify that any code claims in the docs match the actual source (commands, file paths, API routes, env vars, config defaults)
3. **qa** (`.claude/roles/qa.md`) — acceptance criteria coverage

*No tester — docs have no test counterparts.*
*No accessibility — no rendered UI changed.*

---

### Pipeline: config

*Triggered when `.json`, `.yaml`, `.yml`, `.sh`, `Dockerfile*`, or `Makefile` changed.*

Spawn in parallel:

1. **reviewer** (`.claude/roles/reviewer.md`) — correctness, security (secrets exposure, privilege escalation, unsafe defaults)
2. **qa** (`.claude/roles/qa.md`) — acceptance criteria coverage

*No tester — config files have no unit test counterparts.*
*No accessibility — no user-facing UI changed.*

---

### Pipeline: content *(future)*

*Triggered when files under `content/`, `blog/`, or `posts/` change.*

Spawn in parallel:

1. **content-reviewer** — grammar, clarity, consistent voice, factual accuracy, tone for WivWav audience (wheelchair accessible vehicle buyers and caregivers)
2. **qa** (`.claude/roles/qa.md`) — acceptance criteria coverage

---

### Pipeline: mixed

*Triggered when files from more than one type changed in the same commit.*

Build the sub-agent list as the **union** of the matching individual pipelines — deduped. `reviewer` and `qa` run once even if multiple pipeline types match.

Example: `apps/web/` changes + `.md` changes → web + docs → reviewer (once) + accessibility + tester + docs-accuracy + qa (once).

---

## Step 6 — Collect results and report

After all sub-agents complete:

- **Track the flagged set**: record which sub-agents returned `REVISION_NEEDED: yes`. This list is used in Step 7 to scope the selective re-review — carry it forward.
- **Overall verdict**:
  - Any `REVISION_NEEDED: yes` → **REVISION NEEDED**
  - All `REVISION_NEEDED: no` → **READY TO FINISH**

- Report findings grouped by sub-agent, numbered, labeled [CRITICAL] / [WARNING] / [SUGGESTION].
- If REVISION NEEDED: a prioritized fix list — [CRITICAL] first, then [WARNING].

**Post results to the PR or issue:**

After reporting to the user, post the full findings and recommended fix plan as a comment on the PR (preferred) or the linked issue. Use `gh pr comment {PR#}` if a PR exists for the branch; otherwise use `gh issue comment {N}`.

Format the comment with the attribution header, then the full findings (grouped by sub-agent, labeled [CRITICAL] / [WARNING] / [SUGGESTION]), then a **Recommended fix plan** section that lists fixes in priority order with a one-line description of each change.

```bash
# Find the PR number for the current branch
gh pr list --head $(git branch --show-current) --state open --json number --jq '.[0].number'

# Post the comment
gh pr comment {PR#} --body "$(cat <<'EOF'
**code-review[1]** · `wivwav-code-review` · {YYYY-MM-DD}

## Review verdict: {REVISION NEEDED | READY TO FINISH}

...findings...

## Recommended fix plan

...ordered fix list...
EOF
)"
```

If no PR exists yet (branch not pushed or PR not open), post to the issue instead:
```bash
gh issue comment {N} --body "..."
```

---

## Step 7 — Apply fixes and selective re-review

If REVISION NEEDED:

Ask the user: **"Should I apply the [CRITICAL] and [WARNING] fixes now?"**

- If **no**: stop here and wait for the user to direct next steps.
- If **yes**:
  1. Apply fixes in priority order ([CRITICAL] first). Report each fix as it is applied with the file and what changed.
  2. **Selective re-review** — re-run only the sub-agents from the flagged set (Step 6). Use the same model tier from Step 4. Sub-agents that were already clean do not run again.
  3. If all re-run agents return `REVISION_NEEDED: no`: the fix cycle is complete — continue to Step 8.
  4. If any agent still returns `REVISION_NEEDED: yes` after the selective re-review: this is the final cycle. Report the remaining findings. Ask the user: **"Some issues remain after the second review pass. Should I apply these fixes too, or handle them manually?"**
     - If yes: apply remaining [CRITICAL] and [WARNING] fixes, then continue to Step 8 without another re-review.
     - If no: note the outstanding issues and continue to Step 8.

Do not apply SUGGESTION-level items unless the user explicitly asks.

---

## Step 8 — Detect whether a PR is already open

Before deciding what to do with fixes, check whether this branch already has an open PR:

```bash
PR_NUMBER=$(gh pr list --head $(git branch --show-current) --state open --json number --jq '.[0].number')
```

- If `PR_NUMBER` is non-empty: the PR exists — follow **Step 8A (post-PR path)**.
- If `PR_NUMBER` is empty: no PR yet — follow **Step 8B (pre-PR path)**.

---

## Step 8A — Post-PR path (PR is already open)

The review ran against a branch that already has a draft PR. Fixes (if any) need to be committed and pushed, and if the review is clean the PR should be marked ready.

1. Run `git status --short` and list every uncommitted file to the user.
2. Run `pnpm test` (from the repo root) to confirm everything still passes.
3. If tests fail: report the failure and ask the user how to proceed. Do not continue.
4. If tests pass and there are uncommitted changes: commit them.
   ```bash
   git add {changed files}
   git commit -m "fix({scope}): address code review findings (refs #{N})
   
   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   git push
   ```
5. If the overall verdict is **READY TO FINISH** (no CRITICAL or WARNING findings remain):
   - Post a summary comment on the PR:
     ```bash
     gh pr comment {PR_NUMBER} --body "$(cat <<'EOF'
     **code-review[1]** · `wivwav-code-review` · {YYYY-MM-DD}
     
     ## Review verdict: READY FOR HUMAN REVIEW ✓
     
     All sub-agents passed. No CRITICAL or WARNING findings.
     
     **Reviewed:** {comma-separated list of sub-agents that ran}
     **Changed files:** {N files}
     **Tests:** passing
     
     Marking PR ready for human review.
     EOF
     )"
     ```
   - Mark the PR ready:
     ```bash
     gh pr ready {PR_NUMBER}
     ```
   - Tell the user: "PR #{PR_NUMBER} is marked ready for review. A human reviewer can now approve and merge."
6. If the verdict is still **REVISION NEEDED** after two fix cycles: post a comment noting the outstanding issues and tell the user manual intervention is needed.

---

## Step 8B — Pre-PR path (no PR open yet)

1. Run `git -C "$WORKTREE_ROOT" status --short` and list every uncommitted file to the user.
2. Run tests from the worktree root, serialized with a lockfile to prevent concurrent test runs across worktrees from colliding on shared infrastructure (PostgreSQL, Meilisearch, Valkey). Use the platform-appropriate locking utility (`flock` on Linux, `lockf` on macOS):
   ```bash
   # Linux (flock is built-in):
   flock /tmp/wivwav-test.lock pnpm --dir "$WORKTREE_ROOT" test
   # macOS (lockf is built-in; -k keeps the file for ordered locking):
   lockf -k /tmp/wivwav-test.lock pnpm --dir "$WORKTREE_ROOT" test
   ```
3. If tests fail: report the failure and ask the user how to proceed.
4. If tests pass: leave all review-cycle fixes uncommitted in the working tree.
5. Do **not** commit or push. `/wivwav-finish-issue` is the command that runs final validation, commits, pushes, and opens the draft PR.

---

## Step 9 — What's next

After reporting the verdict and completing any fixes or verification, tell the user explicitly which of these applies:

**Post-PR path (PR already open):**
- **READY, PR marked ready** → "PR #{PR_NUMBER} is ready for human review. Approve and run `/wivwav-merge-pr` to land it."
- **REVISION NEEDED, issues remain** → "Outstanding findings are listed above. Fix them and re-run `/wivwav-code-review {N}`."

**Pre-PR path (no PR open):**
- **READY TO FINISH, no uncommitted changes** → "Run `/wivwav-finish-issue` to validate, push, and open the draft PR."
- **READY TO FINISH, review fixes left uncommitted** → "Run `/wivwav-finish-issue {N}` to run final validation, commit, push, and open the draft PR."
- **REVISION NEEDED, fixes applied and selective re-review passed** → "Run `/wivwav-finish-issue {N}` to validate, commit, push, and open the draft PR."
- **REVISION NEEDED, fixes applied but issues remain after two cycles** → "Manual review needed — the remaining findings are listed above. Fix them, then run `/wivwav-code-review {N}` for a fresh pass."
- **REVISION NEEDED, fixes not yet applied** → "Apply the remaining fixes listed above, then re-run `/wivwav-code-review {N}`."
