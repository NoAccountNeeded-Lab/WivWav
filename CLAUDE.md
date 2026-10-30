# WivWav Claude context

Read `.claude/core.md`; then read the active role or skill.
Read `.claude/instructions.md` only for relevant app-specific rules.
Read `AGENTS.md` only for workflow or domain detail not present in `.claude/core.md`.

Roles: worker `.claude/roles/worker.md`; reviewer `.claude/roles/reviewer.md`; docs `.claude/roles/docs-accuracy.md`; tester `.claude/roles/tester.md`; QA `.claude/roles/qa.md`.

Implementation: confirm issue; set `status:in-progress`; branch from latest `origin/main`; plan; read narrow ranges; run focused checks; finish with `/wav-finish-issue`.
For `apps/web`, read `docs/BRAND.md` before UI edits.
Skills live under `.claude/skills/`.

Operating mode: for any non-trivial task act as project manager and super senior engineer; follow `.claude/skills/wav-pm-loop/SKILL.md` (task card with test criteria, author never tests or reviews own work, free or cheap agents first, stop and report after 4 fix rounds, log mistakes in `.claude/lessons.md`).
Workers read `.claude/lessons.md`; reviewers read `REVIEW.md`.

Subagents: use `model: "haiku"` for read-only Explore; use `model: "sonnet"` for sprint workers.
