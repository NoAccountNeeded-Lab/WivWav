---
description: Create a well-formed GitHub issue for WivWav with required structure, labels, and attribution. Use when an agent or user wants to file a new issue, bug report, or feature request.
argument-hint: "[issue-title-or-description]"
---

# Create Issue

Use this skill when creating a GitHub issue for WivWav — whether filing a bug, scoping a feature, or capturing a research finding. The resulting issue must be immediately actionable by a worker agent via `/wivwav-run-sprint`.

## Before creating

1. **Search for duplicates** — run `gh issue list --search "<keywords>" --state all` before creating. If a duplicate exists, comment on the existing issue instead.
2. **Determine the issue type** to pick the right title prefix and label:

| Type | Title prefix | Label |
|------|-------------|-------|
| Feature / enhancement | `feat(scope):` | `enhancement` |
| Bug | `bug(scope):` | `bug` |
| Cleanup / simplification | `chore(scope):` | `cleanup` |
| Infrastructure / tooling | `chore(scope):` | `infrastructure` |
| Research / architecture | `discussion(scope):` | — (no status label) |
| Documentation | `docs(scope):` | `documentation` |

Scope is the affected package or area: `web`, `api`, `scraper`, `db`, `queue`, `agents`, `ops`, `infra`.

## Issue body structure

Use this template exactly — all sections are required unless noted:

```markdown
## Context
<1–3 paragraphs: why this matters, what triggered the issue, relevant background.
For bugs: include observed vs. expected behaviour, where in the code the problem lives,
and any evidence gathered (log lines, file:line refs, test output).>

## Problem / Goal
<What specifically needs to change and why. Be concrete — name files, functions, or
routes. For multi-part issues, use a numbered list.>

## Proposed approach
<How to solve it. Not a full design spec, but enough to unblock a worker agent:
key files to touch, rough sequence of changes, interfaces to add or modify.
Skip this section only for pure research/discussion issues.>

## Acceptance Criteria
- [ ] <Testable, observable outcome — not "write tests" but "tests pass for X">
- [ ] <Another concrete deliverable>
- [ ] <Include a manual QA step when user-facing UI is touched>

## Notes
<Optional. Static evidence examined, dead ends ruled out, constraints, links to
related issues or PRs. Omit if empty.>
```

## AC quality rules

Each AC item must be:
- **Observable** — describes a state someone can verify, not a task ("the source retries on the next run" not "add retry logic")
- **Scoped** — specific enough that a worker agent knows when it's done
- **Testable** — either covered by an automated test, a manual QA step, or an observable system state

Avoid vague items like "update the UI" or "add tests". Write at least two AC items. Include a manual QA item whenever the change touches `apps/web`.

## Labels to apply

Always apply exactly one type label (`enhancement`, `bug`, `cleanup`, etc.).  
Add `status:ready` when the issue is fully scoped and ready for a worker agent.  
Omit `status:ready` for research/discussion issues or issues that need more scoping.  
Add secondary labels when clearly applicable: `observability`, `research-platform`, `risk`, `infrastructure`.

## Creating the issue

```bash
gh issue create \
  --title "<prefix(scope): concise imperative title>" \
  --body "$(cat <<'EOF'
<rendered body from template above>
EOF
)" \
  --label "<type-label>" \
  --label "status:ready"   # omit if not ready
```

## Attribution (agent-created issues only)

If you are a spawned agent (Agent-Role and Agent-Index are in your context), add an attribution comment immediately after creation:

```bash
gh issue comment <N> --body "🤖 **{role}[{index}]** · \`wivwav-create-issue\` · $(date +%Y-%m-%d)"
```

Interactive (human-driven) use does not require the attribution comment.

## After creating

- Report the issue URL and number.
- If `status:ready` was applied, tell the user they can run `/wivwav-run-sprint <N>` to start work.
- If the issue needs more scoping before it is ready, say what information is missing.
