<!-- schema-version: 1 -->
# Usage Report: Issue #515

Purpose: record model and token usage by phase so sprint costs can be compared by issue area.

## Metadata

- Sprint run: run-sprint/2026-06-29T23:38
- Branch: fix/issue-515-canonicalize-vehicle-and-accessibility-fields-befo
- Worktree: /Users/matt/Projects/NoAccountNeeded-Lab/WivWav/.claude/worktrees/issue-515-fixdata-canonicalize-vehicle-and-accessibility-fie
- Effort guidance: high
- Model guidance: sonnet
- Labels: bug, status:ready, risk

## Phase Usage

| Phase | Agent role/index | Provider | Model | Input tokens | Output tokens | Cache read tokens | Cache write tokens | Tool calls | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| run-sprint | orchestrator/0 | n/a | n/a | 0 | 0 | 0 | 0 | deterministic CLI | Generated context artifacts. |
| worker | worker/1 | Anthropic | claude-sonnet-4-6 | unavailable | unavailable | unavailable | unavailable | unavailable | Implementation phase: DB migration, canonicalize.ts, toDocument update, BLVD scraper fix, backfill job, tests. |
| reviewer | reviewer/1 | Anthropic | claude-sonnet-4-6 | 72974 | unavailable | unavailable | unavailable | 45 | Async subagent review. 10 findings, 4 fixed, 6 deferred. |
| finish | worker/1 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Fill after PR creation. |

## Reporting Notes

- Use provider-reported token counts when available.
- If a runtime does not expose token usage, write `unavailable` and include the model name.
- Keep provider-specific model names here; keep workflow prompts provider-neutral.
