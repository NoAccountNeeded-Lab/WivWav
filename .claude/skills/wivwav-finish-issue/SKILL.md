---
description: Validate, commit, push, and open or update a draft PR for a completed issue
argument-hint: "[issue-number]"
---

# Finish issue

Use only when explicitly asked to finish, ship, commit, push, open a PR, or invoke `/wivwav-finish-issue`.
Never commit, push, or open a PR after failed validation.

1. Reject `main`, `master`, or detached `HEAD`.
2. Resolve issue number from `$ARGUMENTS`, branch, or request.
3. Inspect `git status --short` and `git diff --stat`.
4. For `apps/web`, read `docs/BRAND.md`; add accessibility QA evidence.
5. For `apps/api/src/routes`, verify and stage `docs/api-routes.md` when routes changed.
6. Run from repository root:

```bash
pnpm typecheck && pnpm lint && pnpm build
lockf -k /tmp/wivwav-test.lock pnpm test
```

On Linux, replace the test command with:

```bash
flock /tmp/wivwav-test.lock pnpm test
```

7. On failure: stop; report; do not commit.
8. Stage only issue files; exclude `.env`, caches, unrelated work, and unrelated dirty files.
9. Commit completed work as `type(scope): description (fixes #N)`; use `refs #N` only for intentionally partial work.
10. Every agent commit requires `Co-Authored-By`; add `Agent-Role`, `Agent-Index`, and `Sprint-Run` when available.
11. Push the branch.
12. Open or update a draft PR. First line: `Fixes #N`, or `Refs #N` for partial work. Then include attribution, summary, acceptance evidence, tests, accessibility evidence, QA, risk, gaps, deployment impact, rollback, and smoke checks.
13. Set `status:needs-review` and remove `status:in-progress`.
14. Report commit SHA, PR URL, and passed validation.
15. Tell the user to review and mark the PR ready; after approval use `gh pr merge {N} --auto`; include remaining manual QA checks.
