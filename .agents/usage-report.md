# Usage Report: Issue #383

Purpose: record model and token usage by phase so sprint costs can be compared by issue area.

## Metadata

- Sprint run: run-sprint/2026-06-20T05:20
- Branch: feat/issue-383-discover-ai-chat-driven-search-page-with-inline-fi
- Worktree: .claude/worktrees/agent-ab50c3d3f87d52791
- Effort guidance: standard
- Model guidance: auto
- Labels: feat, web, discovery, ai-chat

## Phase Usage

| Phase | Agent role/index | Provider | Model | Input tokens | Output tokens | Cache read tokens | Cache write tokens | Tool calls | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| run-sprint | orchestrator/0 | n/a | n/a | 0 | 0 | 0 | 0 | deterministic CLI | Generated context artifacts. |
| worker | worker/1 | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | ~55 | Created /discover page (3 new files), fixed reviewer findings, ran lint/tests. |
| reviewer | reviewer (subagent) | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | ~36 | Reviewed accessibility, QA, and correctness. Found 6 issues (2 critical, 4 warning). |

## Reporting Notes

- Use provider-reported token counts when available.
- If a runtime does not expose token usage, write `unavailable` and include the model name.
- Keep provider-specific model names here; keep workflow prompts provider-neutral.
