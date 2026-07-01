---
applyTo: '**'
---

# SDLC

Use issues, labels, PRs, and checks as workflow state.
Before implementation: confirm issue number and acceptance criteria; identify design, accessibility, QA, and release-note requirements.
During implementation: keep commits scoped; reference the issue in commits and PR body; do not mix unrelated features.
Before merge: CI and review pass; every acceptance criterion has concise PR evidence; user-facing changes pass accessibility review; QA notes exist; deployment changes include release and rollback notes; skipped checks, missing tests, and follow-ups are explicit.
Merge only through the `main` merge queue: `gh pr merge {N} --auto`.
Do not direct-merge; do not pass `--rebase` or `--delete-branch`.
