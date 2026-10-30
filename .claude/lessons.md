# Lessons from agent mistakes

Coders and workers: read this before you start. Reviewers: read `REVIEW.md`, which summarizes it.

The project manager appends one entry for every finding that required a fix. Write each as a rule that prevents a repeat. Fold recurring ones into `REVIEW.md`.

Format: `- YYYY-MM-DD | agent+model | what went wrong | rule | task`

## Entries

- 2026-10-22 | claude sonnet (sAIgon writer) | missed two bugs (detail capped at 2000, integer step ignored) and left work uncommitted | Test every limit and step boundary; commit before reporting done | sAIgon T57
- 2026-10-23 | claude sonnet (generative-shell) | image pixel bomb accepted; arrow to a routed shape silently dropped | Bound all external input sizes; never drop an input silently, error or handle it | generative-shell components
- 2026-10-24 | claude sonnet (worker) | used bare `git stash` in a shared-stash repo | Never use bare `git stash`; use a WIP commit | generative-shell and Mote
- 2026-10-24 | claude sonnet (Mote) | event crash, unenforced MCP schemas, unredacted model output, loose permissions | Enforce declared schemas, redact model output, set least-privilege permissions | Mote daemon
- 2026-10-29 | opencode free (router model) | false provenance in a plan, out-of-scope grep, unnecessary tool use | Treat free-model output as a claim; require quoted command output | WivWav AI ops read-only survey
- 2026-10-29 | opencode glm-5.3-flash-free | initial 12 tests had 4 errors | Run the tests before reporting; an independent tester re-runs them | synthetic helper
- 2026-10-30 | claude (diagnosis session) | handoff recorded findings but the session ended with no code, tests or PR, and with stale auth | Handoffs state the exact next command, auth status and what is unverified | ops diagnosis
