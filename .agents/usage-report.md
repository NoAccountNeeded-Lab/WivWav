# Usage Report: Issue #342

Purpose: record model and token usage by phase so sprint costs can be compared by issue area.

## Metadata

- Sprint run: run-sprint/2026-06-18T11:07
- Branch: feat/issue-342-add-guided-listing-refresh-workflow
- Worktree: .claude/worktrees/issue-342-featops-add-guided-listing-refresh-workflow
- Effort guidance: standard
- Model guidance: auto
- Labels: enhancement, status:ready

## Phase Usage

| Phase | Agent role/index | Provider | Model | Input tokens | Output tokens | Cache read tokens | Cache write tokens | Tool calls | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| run-sprint | orchestrator/0 | n/a | n/a | 0 | 0 | 0 | 0 | deterministic CLI | Generated context artifacts. |
| worker | worker/5 | OpenAI | GPT-5 (auto) | unavailable | unavailable | unavailable | unavailable | unavailable | Runtime does not expose token counters; implementation and local review completed. |
| reviewer | reviewer/5 | OpenAI | GPT-5 (auto) | unavailable | unavailable | unavailable | unavailable | unavailable | No separate reviewer-agent tool was available; worker performed blocking review using reviewer, QA, accessibility, performance, and docs-accuracy role files. |
| finish | worker/5 | OpenAI | GPT-5 (auto) | unavailable | unavailable | unavailable | unavailable | unavailable | Not run yet; pnpm validation/finish blocked by runtime escalation usage limit. |
| validate+finish | worker/pickup | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | unavailable | Pickup agent: fixed TS error (Partial<Record> init), fixed Next.js .js import extensions, confirmed all checks pass, then ran pnpm wivwav finish 342. |

## Reporting Notes

- Use provider-reported token counts when available.
- If a runtime does not expose token usage, write `unavailable` and include the model name.
- Keep provider-specific model names here; keep workflow prompts provider-neutral.
