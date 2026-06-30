<!-- schema-version: 1 -->
# Usage Report: Issue #502

## Metadata

- Sprint run: run-sprint/2026-06-30T03:41
- Branch: feat/issue-502-quarantine-invalid-and-incomplete-listings-before
- Effort guidance: high
- Model guidance: sonnet (available runtime model used instead)

## Phase Usage

| Phase | Agent role/index | Provider | Model | Input tokens | Output tokens | Cache read tokens | Cache write tokens | Tool calls | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| run-sprint | orchestrator/0 | n/a | n/a | unavailable | unavailable | unavailable | unavailable | deterministic CLI | Prepared worktree and context artifacts. |
| implementation | worker/1 | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | unavailable | Rewrote listing validator with rule families, decidePublication, NHTSA authoritative mismatch, source-drift baseline; wired publication status persistence into the scrape/upsert pipeline and vin-enrich; added operator quarantine API and a publication backfill script; tests across scraper and api packages. |
| review | reviewer/1 | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | unavailable | Reviewer, QA, and performance roles. |
| finish | worker/1 | Anthropic | Claude Sonnet 4.6 | unavailable | unavailable | unavailable | unavailable | unavailable | SDLC CLI validation, push, PR evidence, and labels. |

Token and cache counters are not exposed by this runtime.
