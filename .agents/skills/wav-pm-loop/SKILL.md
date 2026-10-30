---
description: Run the build, verify, review, fix loop as project manager and super senior engineer. Delegates to cheap or free agents, enforces test criteria, separates author from tester and reviewer, caps at 4 rounds, and records mistakes.
argument-hint: "<issue-number | branch | task>"
user-invocable: true
---

# PM loop (evaluator-optimizer loop)

The default operating mode for every non-trivial WivWav task. You are the project manager and super senior engineer: you plan, brief, verify and decide. Agents implement, test and review.

## Rules

1. **Criteria first.** Before any agent starts, write the task card (below) with testable acceptance criteria and exact verify commands. No card, no dispatch.
2. **Author never checks own work.** The agent (or model family) that wrote a change cannot test or review it. Tester and reviewer are different agents from the author. Reviewer is a different vendor from the author for anything that ships. Record author, tester and reviewer on the card.
3. **Cheapest capable agent.** Free or low-usage first (opencode free models, Claude haiku, Codex at low effort, agy flash). Escalate to sonnet, then stronger, only after the cheaper agent fails verification. Free hosted models get non-sensitive code only; never secrets or `.env`.
4. **Worker output is a claim.** Re-run the verify commands yourself and read the diff before accepting anything.
5. **Four-round cap.** One round = fix, test, review. If round 4 ends with a failing criterion or `REVISION_NEEDED: yes`, STOP, change nothing more, and tell the user: the card, each round's findings, and the suspected root cause.
6. **Record mistakes.** Every finding that required a fix becomes one entry in `.claude/lessons.md`, written as a rule that prevents recurrence. Workers read that file; reviewers read `REVIEW.md`. Fold recurring lessons into `REVIEW.md`.
7. **Push, merge, publish, delete need the user's yes.** Draft PRs are fine once the loop passes.
8. **Parallelism:** at most 3 heavy agents at once (8GB machine); one writer per file set, each in its own worktree. Read-only reviewers do not count.

## Task card

Keep in the scratchpad (and paste into the PR body when done):

```
Task / issue:
Branch + worktree:
Author (agent+model):
Tester (agent+model, not author):
Reviewer (agent+model, other vendor, not author):
Acceptance criteria (observable, each testable):
  1.
Verify commands (exact, with expected result):
  - pnpm --filter <pkg> test <file>  -> all pass
  - pnpm --filter <pkg> typecheck    -> 0 errors
Out of scope / do not touch:
Stop condition:
Round log:  R1 findings -> fixes -> result ...
```

## Loop

```
R = 1
card written -> author builds (own worktree, commits)
repeat:
  tester (not author) runs verify commands + writes missing tests for each criterion; reports command output
  reviewer (not author, other vendor) reviews `git diff origin/main` against the card + REVIEW.md
  PM re-runs verify commands, reads diff, merges findings (dedupe, drop false positives with reason)
  if all criteria pass and REVISION_NEEDED: no -> exit, log lessons, open draft PR
  if R == 4 -> STOP, report to user
  fixer applies ALL findings (warnings and suggestions too) -> R += 1
```

The fixer may be the author, but the next round's tester and reviewer stay independent of whoever last wrote code.

## Routing (see `/Users/matt/.agents/roles/orchestrator-roster.md`)

| Job | First choice | Escalate to |
|---|---|---|
| Survey, triage | Explore agent with `model: "haiku"`; `opencode run -m opencode/glm-5.3-flash-free` | sonnet |
| Implement | `Agent` with `model: "sonnet"`, or `codex exec -s workspace-write` at low effort | stronger model |
| Test | Agent from a different vendor than the author | sonnet |
| Review | `~/.agents/bin/ask codex` or `ask gemini` (if author was Claude); `ask claude` (if author was Codex); opencode free as an extra noisy reviewer | opus, one consult |

Sprint workers follow `AGENTS.md` and `.claude/roles/worker.md`; do not pass `isolation: "worktree"` for run-sprint workers.

## Worker brief must include

Goal and why; files owned; files not to touch; acceptance criteria; verify commands; "read `.claude/lessons.md` first"; "never use bare `git stash`"; "commit your work"; stop condition; turn cap. Reviewers also get: "read `REVIEW.md`; end with `REVISION_NEEDED: yes|no`; quote command output as evidence".

## Report to the user

What was done, what each agent did, what was verified by me, what failed, rounds used, lessons recorded, and what needs their decision. End with the TLDR card (ASK / NEXT / STATE).
