# Merge Queue for `main`

As parallel agent work increased, independently green PRs could still conflict
after merging in quick succession — branch B passes CI against `main` at commit
X, but by the time it merges, branch A has already landed and changed files B
depends on. A GitHub merge queue tests each PR against the queue's actual merge
order instead of its stale base, removing that window.

## Current branch protection

`main` is protected by a repository ruleset, not classic branch protection
(`Settings → Rules → Rulesets → Protect Main Branch`, also readable via
`gh api repos/NoAccountNeeded-Lab/WivWav/rulesets/16891769`):

| Rule | Configuration |
|---|---|
| Deletion | `main` cannot be deleted |
| Non-fast-forward | No force-pushes to `main` |
| Merge queue | See below |
| Required status checks | `Docker builds`, `Lint & Typecheck`, `Test` (all from the `ci.yml` workflow) |

`bypass_actors` is empty — no role or app can skip the ruleset, including admins.

### E2E smoke is signal, not a required check

`ci.yml` also runs an `e2e` job (`E2E smoke`) on every PR, merge-group, and
`main` run, but it is deliberately **not** in the ruleset's required status
checks above and does not block the merge queue. The suite is still early
and growing, and its critical smoke path hasn't been defined yet, so a flaky
or slow E2E run should not stall unrelated PRs from merging. It does,
however, gate post-merge image publishing: `publish` in `ci.yml` needs `e2e`
to succeed on the `main` push before it pushes anything to GHCR — see
`docs/ops/deployment.md`. Promoting `E2E smoke` to a required merge-queue
check is a deliberate future decision, not an oversight.

### Merge queue parameters

| Parameter | Value | Meaning |
|---|---|---|
| `merge_method` | `REBASE` | Matches the repo-wide rebase-only merge policy |
| `grouping_strategy` | `ALLGREEN` | Queued PRs are batched and tested together; the batch only merges if every PR in it is green |
| `max_entries_to_build` | 5 | Up to 5 PRs are spun up as merge groups at once |
| `min_entries_to_merge` / `max_entries_to_merge` | 1 / 5 | A merge group can contain 1–5 PRs |
| `min_entries_to_merge_wait_minutes` | 1 | Minimum wait before merging a group, to let more PRs join |
| `check_response_timeout_minutes` | 60 | A queued PR is dropped if checks don't report within 60 minutes |

## CI support for `merge_group`

`.github/workflows/ci.yml` triggers on `merge_group` in addition to `push` and
`pull_request`:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  merge_group:
```

When GitHub adds a PR to the queue it creates a temporary
`gh-readonly-queue/main/pr-{N}-{sha}` ref and runs CI against it. The three
required jobs (`docker`, `lint-typecheck`, `test`) run exactly as they do on a
normal PR — no merge-queue-specific job logic was needed.

## New merge path

`gh pr merge --rebase` alone fails on a ruleset-protected branch: GitHub
rejects the immediate merge and requires queue membership instead. Merge with
`--auto` only:

```bash
gh pr merge {N} --auto
```

`--auto` enqueues the PR into the merge queue once all required checks pass
and any required reviews are satisfied, rather than attempting an immediate
merge. Do **not** pass `--rebase` or `--delete-branch`: the queue controls the
merge strategy (so `--rebase` is rejected) and deletes the remote branch itself
after the queued merge completes (so `--delete-branch` is rejected). After the
merge, local-only cleanup if desired: `git checkout main && git pull`,
`git remote prune origin` (clears the `gh-readonly-queue/...` ref), and
`git branch -d <branch>`.

## Verification

Real queued merges have run successfully on `main`, observable via
`gh api "repos/NoAccountNeeded-Lab/WivWav/actions/runs?event=merge_group"`:

| PR | Queue ref | Run | Conclusion |
|---|---|---|---|
| #319 | `gh-readonly-queue/main/pr-319-f04eb7c...` | [27592894057](https://github.com/NoAccountNeeded-Lab/WivWav/actions/runs/27592894057) | success |
| #310 | `gh-readonly-queue/main/pr-310-3813989...` | [27588755842](https://github.com/NoAccountNeeded-Lab/WivWav/actions/runs/27588755842) | success |
| #316 | `gh-readonly-queue/main/pr-316-6aed866...` | [27588654580](https://github.com/NoAccountNeeded-Lab/WivWav/actions/runs/27588654580) | success |
| #317 | `gh-readonly-queue/main/pr-317-78c0291...` | [27589467074](https://github.com/NoAccountNeeded-Lab/WivWav/actions/runs/27589467074) | success |
| #318 | `gh-readonly-queue/main/pr-318-ae29682...` | [27589764544](https://github.com/NoAccountNeeded-Lab/WivWav/actions/runs/27589764544) | success |
| #311 | `gh-readonly-queue/main/pr-311-1d30c3f...` | [27592233947](https://github.com/NoAccountNeeded-Lab/WivWav/actions/runs/27592233947) | success |
| #312 | `gh-readonly-queue/main/pr-312-9f99eb5...` | [27592265635](https://github.com/NoAccountNeeded-Lab/WivWav/actions/runs/27592265635) | success |
| #314 | `gh-readonly-queue/main/pr-314-84ef8bb...` | [27592265667](https://github.com/NoAccountNeeded-Lab/WivWav/actions/runs/27592265667) | success |

To reproduce this check yourself:

```bash
gh api "repos/NoAccountNeeded-Lab/WivWav/actions/runs?event=merge_group&per_page=10" \
  --jq '.workflow_runs[] | {id, head_branch, conclusion}'
```

## Troubleshooting

### `gh pr merge` rejects with a protected-branch error

Use `--auto` (see **New merge path** above) instead of merging immediately —
the ruleset requires queue membership, not a direct merge.

### A queued PR never merges

Check `check_response_timeout_minutes` (60 min) hasn't been exceeded by a
slow or hung check, and confirm the PR's required checks (`Docker builds`,
`Lint & Typecheck`, `Test`) actually completed rather than being skipped.
`gh pr checks {N}` shows the live state; queue-specific runs also appear in
`gh api repos/NoAccountNeeded-Lab/WivWav/actions/runs?event=merge_group`.

### Required check name doesn't match a job

The ruleset's `required_status_checks` reference job **display names**
(`name:` in `ci.yml`), not job IDs. If a job in `ci.yml` is renamed, update
the ruleset (`gh api --method PUT repos/.../rulesets/16891769 ...`) in the
same PR — otherwise the renamed job's runs never satisfy the old required
check and PRs will queue forever without merging.
