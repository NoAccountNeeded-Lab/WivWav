# Usage Report: Issue #80

Purpose: record model and token usage by phase so sprint costs can be compared by issue area.

## Metadata

- Sprint run: run-sprint/2026-06-20T23:31
- Branch: feat/issue-80-conversion-brand-profiles-braunability-vmi-vantage
- Worktree: .claude/worktrees/issue-80-featscraper-conversion-brand-profiles-braunability
- Effort guidance: standard
- Model guidance: auto
- Labels: enhancement, research-platform

## Phase Usage

| Phase | Agent role/index | Provider | Model | Input tokens | Output tokens | Cache read tokens | Cache write tokens | Tool calls | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| run-sprint | orchestrator/0 | n/a | n/a | 0 | 0 | 0 | 0 | deterministic CLI | Generated context artifacts. |
| worker | worker/1 | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | ~95 | Created 9 new files, wired queue workers + schedules, fixed reviewer findings. |
| reviewer | reviewer (subagent) | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | ~44 | Reviewed correctness, QA, and performance. Found 2 warnings + suggestions. |
| finish | worker/1 | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | ~10 | Fixed reviewer findings, committed, opened draft PR. |

## Reporting Notes

- Use provider-reported token counts when available.
- If a runtime does not expose token usage, write `unavailable` and include the model name.
- Keep provider-specific model names here; keep workflow prompts provider-neutral.
