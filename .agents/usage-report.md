# Usage Report: Issue #366

Purpose: record model and token usage by phase so sprint costs can be compared by issue area.

## Metadata

- Sprint run: run-sprint/2026-06-18T11:07
- Branch: feat/issue-366-add-grafana-alert-rules-and-notification-routing
- Worktree: .claude/worktrees/issue-366-featops-add-grafana-alert-rules-and-notification-r
- Effort guidance: high
- Model guidance: auto
- Labels: enhancement, status:ready, infrastructure, observability

## Phase Usage

| Phase | Agent role/index | Provider | Model | Input tokens | Output tokens | Cache read tokens | Cache write tokens | Tool calls | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| run-sprint | orchestrator/0 | n/a | n/a | 0 | 0 | 0 | 0 | deterministic CLI | Generated context artifacts. |
| worker | worker/1 | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | unavailable | Pickup worker: validated implementation, ran typecheck/lint/build/test, all passing. |
| reviewer | reviewer/TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Fill after review. |
| finish | worker/1 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Fill after PR creation. |

## Reporting Notes

- Use provider-reported token counts when available.
- If a runtime does not expose token usage, write `unavailable` and include the model name.
- Keep provider-specific model names here; keep workflow prompts provider-neutral.
