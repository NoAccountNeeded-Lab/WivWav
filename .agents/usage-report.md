<!-- schema-version: 1 -->
# Usage Report: Issue #501

## Metadata

- Sprint run: run-sprint/2026-06-30T00:45
- Branch: fix/issue-501-refresh-corrected-source-fields-without-preserving
- Effort guidance: high
- Model guidance: sonnet (available runtime model used instead)

## Phase Usage

| Phase | Agent role/index | Provider | Model | Input tokens | Output tokens | Cache read tokens | Cache write tokens | Tool calls | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| run-sprint | orchestrator/0 | n/a | n/a | unavailable | unavailable | unavailable | unavailable | deterministic CLI | Prepared worktree and context artifacts. |
| implementation | worker/1 | OpenAI | GPT-5 Codex | unavailable | unavailable | unavailable | unavailable | unavailable | Persistence, evidence states, audit/search idempotency, migration, tests, and operations documentation. |
| review | reviewer/1 | OpenAI | GPT-5 Codex | unavailable | unavailable | unavailable | unavailable | unavailable | Reviewer, QA, performance, and docs-accuracy roles. |
| finish | worker/1 | OpenAI | GPT-5 Codex | unavailable | unavailable | unavailable | unavailable | unavailable | SDLC CLI validation, push, PR evidence, and labels. |

Token and cache counters are not exposed by this runtime.
