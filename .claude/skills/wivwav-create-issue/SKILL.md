---
description: Create a structured WivWav GitHub issue with labels and attribution
argument-hint: "[issue-title-or-description]"
---

# Create issue

Search first: `gh issue list --search "<keywords>" --state all`.
If duplicate, comment on the existing issue; do not create another.

| Type | Title prefix | Label |
| --- | --- | --- |
| Feature/enhancement | `feat(scope):` | `enhancement` |
| Bug | `bug(scope):` | `bug` |
| Cleanup | `chore(scope):` | `cleanup` |
| Infrastructure/tooling | `chore(scope):` | `infrastructure` |
| Research/architecture | `discussion(scope):` | none |
| Documentation | `docs(scope):` | `documentation` |

Scopes: `web`, `api`, `scraper`, `db`, `queue`, `agents`, `ops`, `infra`.

Use this body:

```markdown
## Context
{why; trigger; background; for bugs include observed/expected behavior and evidence}

## Problem / Goal
{specific required change; name relevant files, functions, or routes}

## Proposed approach
{files, sequence, interfaces; omit only for pure research/discussion}

## Acceptance Criteria
- [ ] {observable, scoped, testable outcome}
- [ ] {observable, scoped, testable outcome}
- [ ] {manual QA outcome when apps/web changes}

## Notes
{constraints, evidence, rejected paths, related issues; omit if empty}
```

Require at least two observable, scoped, testable acceptance criteria.
Do not use vague task-only criteria such as "update UI" or "add tests."
Require manual QA acceptance criteria for `apps/web`.
Apply exactly one type label.
Add `status:ready` only when fully scoped for a worker.
Do not add `status:ready` to research, discussion, or under-scoped issues.
Add `observability`, `research-platform`, `risk`, or `infrastructure` only when applicable.
Create with `gh issue create`.

Spawned agents must add:

```text
🤖 **{role}[{index}]** · `wivwav-create-issue` · {YYYY-MM-DD}
```

Interactive human-driven creation does not require attribution.
Report issue number and URL.
If ready, report `/wivwav-run-sprint <N>`; otherwise state missing scope.
