# Secure WivWav AI operations: source-drift MVP

Status: group B (private control plane) in progress via #1225; groups A and C–F not started. Updated 2026-10-31. GitHub is the status source; this table is a snapshot.

### Status snapshot (2026-10-31)

| Task | Status | Evidence |
| --- | --- | --- |
| A1–A4 | Partial. Owner provenance recorded on [#843](https://github.com/NoAccountNeeded-Lab/WivWav/issues/843#issuecomment-6513649279); `/docs` and `/openapi.json` default private (enforced at the edge). A1/A2 reports, #1076 design contract (A4) and #1111 reconciliation not done. | #843 closed; #1076, #1111 open |
| B1 | Done (matrix lives in #1225 acceptance criteria and tests). | [#1225](https://github.com/NoAccountNeeded-Lab/WivWav/issues/1225) |
| B2 | Done in code and merged to `main`: [PR #1242](https://github.com/NoAccountNeeded-Lab/WivWav/pull/1242) (opened as a partial draft, merged). Compose secret wiring, docs and e2e callers were missing there and are completed on the follow-up branch. | api 1604, ops 603, web 662 tests pass |
| B3 | Implemented on branch `claude/secure-ai-ops-mvp-0ac0fd`: `docker/edge/*`, API port unpublished, `scripts/edge-smoke.sh`. Awaiting review, PR and release. | #1225 |
| B4 | Implemented on the same branch: `pnpm check:boundaries` (in `pnpm lint`), with tests. | #1225 |
| B5 | Implemented on the same branch: `ops` Compose profile and rollout docs in `docs/ops/deployment.md`. | #1225 |
| C–F | Not started. Blocked until B is accepted: different-vendor review, built-container E2E, Bull Board/session evidence and deploy smoke. | #777, #778, #780, #781 open |

Remaining B acceptance: independent different-vendor review, `pnpm test:e2e` with built containers, Bull Board session flow evidence, and the post-deploy smoke list in `docs/ops/deployment.md`.

## Goal and completion boundary

An authorized assistant can investigate a `needs_remapping` source using bounded evidence, propose and validate a mapping or parser fix, and prepare an operator-reviewable proposal or an issue-scoped draft PR. Live mappings require human approval. Success includes deterministic authorization tests and acceptance evidence in each PR.

Use provider-neutral MCP tools and local stdio first. Local transport may still send evidence to a cloud inference provider. Broader listing administration, arbitrary data queries, queue retries, worker controls, production crawls, automatic source re-enablement, remote MCP (#779), merge, and deployment are follow-ups. Completing draft PRs does not authorize production execution.

## Review findings and existing work

- The requested file did not exist when reviewed; this document preserves and expands the plan agreed in conversation.
- #843 is closed, but its checked-in decision record still says D1–D6 await owner ratification. The owner accepted them in conversation; record that provenance on #843 and reconcile its tracking state before creating its implementation children. Do not invent a second owner decision. Its existing decision record remains the architectural authority.
- #777 (durable audit), #778 (MCP core/stdio), #780 (contracts), and #781 (docs) are open. #1076 is a design issue, not a ready implementation issue. Verify status, branches, PRs, and latest code again at kickoff; this checkout was three commits behind `origin/main` during review.
- Diagnostics already exist, but `diagnostic-auth.ts` still accepts `INTERNAL_API_SECRET`. The #843 reconciliation changes that asymmetric credential to `OPS_API_SECRET`; diagnostics must reject the web service identity.
- Reuse #1111's proposed review-item model. Its wording currently permits automatic high-confidence remaps: revise the source-drift MVP criteria so **every agent-produced live mapping change requires human approval**, regardless of confidence. Do not claim the broader #1111 issue complete when only its mapping slice ships.
- Worker code currently marks drift as `needs_remapping` without AI remap wiring. #1111 describes older API behavior. Survey active producers before implementation and ensure no legacy path bypasses approval.
- Custom adapters may ignore stored mappings. Determine the active adapter before proposing changes; use a parser/code fix when needed, including MobilityWorks if its current adapter remains custom.
- Two prior in-account reviewers agreed on the boundary and backlog reuse. External review attempts were blocked by quota/authentication/tool restrictions; no completed external review is claimed.

## Operational failure diagnosis added 2026-10-30

Recent container logs show why bounded diagnostics need to cover job failures as well as source-drift proposals. Over the last day, the local worker logs recorded repeated `detail-extract` failures for Superior Van & Mobility: 39 of 39 raw pages failed on each observed run, and each submit attempt returned HTTP 500 from `/internal/scraper/detail-extract/submit`. The available Mini API container logs had rotated/restarted before those requests, so the server exception was not recoverable from `docker logs`. Other observed failures included two NHTSA recall upserts returning HTTP 400, an NHTSA complaint upsert returning 503, a BLVD `mark-gone` request returning 500, and an eBay Motors credentials lookup returning 404. Worker capacity refusals were requeued; they were backpressure, not failed executions. These are observations, not confirmed root causes.

The production database also currently reports MobilityWorks as `needs_remapping`, with stored reason `Structure changed — AI remapping unavailable; operator intervention required` and last scrape at 2026-10-16. This is an active example for the MVP's original source-drift workflow.

The current worker HTTP client retains non-success response bodies on `HttpRequestError`, but its error message and worker failure event retain only the status and route. That hid the Zod validation message for the recall 400. API request-completion logs retain status and route but not the associated exception details; container restart also removed the older API logs. Existing read-only job correlation tools should therefore return a bounded, sanitized failure record with queue/job/correlation IDs, source and run IDs when available, attempt/time/status, the safe API error code/message (including field-level validation issues), and adjacent correlated logs. Keep request bodies, credentials, raw seller HTML, and personal data out of model-visible evidence. Distinguish a validation/client-data failure, source/parser failure, server exception, dependency outage, worker-capacity requeue, and worker/coordinator connectivity interruption. When evidence is missing or logs have expired, report that explicitly instead of guessing.

This expands the source-drift MVP's diagnostic acceptance evidence; it does not add broad queue administration or authorize retries, production crawls, mapping changes, or other production writes. In particular, repeated 500 responses from the detail-submit API must be diagnosed at that API boundary before labeling a source as drifted. The Superior Van case is a regression scenario: diagnostics should connect its failed job to all-page submission failures and expose the retained server-side cause when available, while safely reporting log-retention gaps otherwise.

A follow-up read-only check found Superior Van still active and all 39 raw pages marked processed, so those historical failures were not a current raw-page backlog at review time. The public homepage followed its locale redirect to `/en` and returned 200; the Mini's LAN API health endpoint returned 200. An unauthenticated `/v1/listings` request returned 401 as required by the API-key boundary, so that response alone is not evidence of a public-site failure. Keep historical failed-queue records distinct from current service health and pending-work counts.

References: [control-plane decisions](../design/eliminate-admin-urls-private-ops-control-plane.md), [canonical routes](../api-routes.md), issues #757, #843, #777–#781, #1076, #1111, and future lifecycle audit #1072.

## Model routing and cost controls

These recommendations are starting points, not measured capability rankings. The machine roster only recorded trivial checks for older free models. A free model can reason; price is not a capability guarantee. Assign simple tasks by bounded scope and evidence, rather than assuming reasoning can be disabled.

| Profile | Suggested model | Suggested effort | Allowed work |
| --- | --- | --- | --- |
| R | Existing `openrouter/free` router in OpenCode; resolve the actual picker ID locally | Default; no assumed effort control | Read-only inventories, public/synthetic fixtures, documentation from approved facts, evidence summaries |
| F | `opencode/glm-5.3-flash-free`, if present in `/models` | Low if exposed; otherwise default | Mechanical changes to a frozen contract, one small helper or exact test matrix |
| C | `opencode/deepseek-v4.1-flash-free`, if present in `/models` | Medium if exposed; otherwise default | Bounded implementation requiring local judgment, with mandatory review |
| H | Pinned C model at high effort if supported, with an independent human or capable reasoning-model reviewer | High if supported; otherwise default plus mandatory independent review | Architecture, credential boundaries, DB/approval transactions, isolation, final security review |

For F/C/H, use the exact model/variant identifiers shown by the installed CLI. If unavailable, qualify another named free model on a disposable synthetic task, or pause that task for review. A cheaper paid fallback is optional and requires the user's selection; never silently fall back to paid inference. H describes a review requirement, not proof that the named free model is adequate. If an H gate cannot be reviewed, keep dependent tasks blocked while proceeding with independent R/F work.

The current local config selects `openrouter/free`; it does not establish that a separate ranked-router plugin is installed. OpenRouter's free router selects among compatible free models and is not a coding-quality guarantee. Pin a model for code writing where possible; record the resolved model and any fallback. Do not assume two routed calls used independent models. [OpenRouter router behavior](https://github.com/OpenRouterTeam/docs/blob/main/guides/routing/routers/free-router.mdx).

OpenCode currently lists GLM-5.3-Flash Free and DeepSeek V4.1 Flash Free, with limited-time offers and stated zero-retention/no-training terms. Confirm availability and terms at kickoff. Hosted free models receive only non-sensitive code and synthetic/redacted evidence under the shared agent rules; unknown router destinations must never receive production logs, HTML with personal data, secrets, or private material. [OpenCode model catalog and data terms](https://opencode.ai/v2/docs/console/models/).

Effort controls depend on the selected model and OpenCode version. A model with no effort variant uses its default; writing “low” in a prompt does not configure it. Confirm version and `/models` before setting options; do not copy v2 configuration syntax into a v1 install. The local CLI could not start during this review because its log file was denied by the sandbox. [OpenCode models and variants](https://opencode.ai/v2/docs/models).

### Per-task execution rules

1. Start one fresh session per task with this plan, its approved contract, exact allowed files, acceptance criteria, and relevant repo instructions. Avoid loading the whole repo or production context.
2. R tasks stop at a cited report. F/C tasks own one small functional slice plus its tests; target 1–3 source files where practical. If scope grows, stop for a new brief. The atomic migration below is a coordinated exception.
3. Allow one implementation attempt and one correction pass. On repeated failure, ambiguous requirements, auth/schema changes outside scope, or unavailable model, record the blocker and escalate to H rather than looping or broadening access. Use a ten-minute time budget per small packet and preserve useful output at timeout.
4. Check actual command results; never accept a worker's “passed” summary alone. A second reviewer receives the diff and criteria, not the author's reasoning. Before merging, obtain different-vendor review per shared instructions; router randomness alone does not satisfy that requirement.
5. `pnpm wivwav run-sprint` owns worktree/issue/model dispatch. These profiles guide issue sizing and selection; do not override its printed provider-neutral Model/Effort or add a competing dispatcher. If OpenCode cannot represent that dispatch, use `pnpm wivwav start N` for one issue and manually select a qualified model within that prepared workflow.

## Task graph and acceptance criteria

All tasks start **Planned**. Each task row is a worker packet, not necessarily a separate issue or PR. Group related packets into one functional issue/PR; do not create a PR for every test or helper. GitHub becomes the status source at kickoff; add issue/PR links beside these IDs. Never mark a dependent issue ready before its predecessors are accepted.

### A. Establish facts and freeze the contracts

| ID | Task and required output | Depends on | Model / effort | Done when |
| --- | --- | --- | --- | --- |
| A1 | Inventory current routes, credentials, ingress, active remap producers, adapter types, related issues/PRs, and existing audit/proposal code. Cite path/line or issue/PR. | — | R / default | Report separates shipped, proposed, missing, and conflicting behavior; no duplicate work selected. |
| A2 | Check `/models`, model terms/tool support and supported variants. Qualify F and C on a disposable synthetic code-and-test task; record actual model, result, and limitations. | — | R / default; human checks results | Named routes are usable without paid fallback; no credentials or production data are included in evidence. |
| A3 | Record owner ratification on #843 with conversation provenance; reconcile closed tracker and AC for #773/#775/#778/#780. Resolve production `/docs` and `/openapi.json` exposure: default private unless owner explicitly opts in. | A1 | H / high or default + review | D1–D6 and route/exposure matrix are recorded; dependency issues can be scoped without interpreting unresolved policy. |
| A4 | Complete #1076's design contract; define tool schemas, ownership, auth matrix, evidence limits, proposal states and approval semantics. Reconcile #1111's automatic-remap conflict. | A1, A3 | H / high or default + review | Reviewer approves contract; concrete child issues have AC, file ownership, checks, dependencies and rollback notes. No implementation starts from unratified schemas. |

A4 must specify exact request/result limits and timeout/concurrency caps using existing diagnostic conventions where possible. Separate the read-only diagnostic credential from a host-side proposal-writing connector. Neither the model nor a tool result receives an ops secret. Approval is an authenticated server-side operator action bound to the exact proposal and baseline; text in a chat or a model-supplied `approved` flag cannot authorize it. Record denied, failed and successful actions with safe identifiers and correlation IDs. Writes fail closed if their durable audit record cannot be committed.

Keep repository execution in the trusted local WivWav workflow. MCP may return a typed code-fix handoff; it must not expose arbitrary shell/git execution as a tool. Update #1076's broad queue/live-crawl ideas to explicitly deferred for this MVP.

### B. Finish the private control plane

| ID | Task and required output | Depends on | Model / effort | Done when |
| --- | --- | --- | --- | --- |
| B1 | Enumerate credential/route/caller replacements and write the exact boundary test matrix from #843. No runtime edits. | A3 | R / default | H reviewer confirms every caller, Bull Board path and expected credential outcome. |
| B2 | Apply the atomic namespace/credential migration across API, web config caller, ops BFF and Bull Board; update routes and tests together. Reconcile diagnostic asymmetric auth. | B1 approved | H / high or default + review | `/internal/ops/*`, `/internal/config/*`, diagnostics and board match the approved matrix; retired `/admin/*` returns 404; no compatibility alias or ops secret in web. |
| B3 | Implement the specified public-ingress allowlist and remove raw API host publication in production; add edge/private-network tests. | A3 | H / high or default + review | Public edge cannot reach private APIs, including with a valid token; private routes remain authenticated. Public product routes work. |
| B4 | Add `check:boundaries` and wire into existing lint/CI/finish paths using an approved exact allowlist. Include scanner tests. | B1 approved; integrate with B2/B3 | F / low or default | Seeded forbidden URL, web ops-secret reference and exposed API port are caught; legitimate historical/test references pass only via narrow exceptions. |
| B5 | Implement #843's stopped-by-default ops Compose profile and manual start/stop instructions. | A3 | F / low or default | Compose config and focused lifecycle checks prove profile behavior; no public wake route. |

B2 is deliberately one coordinated PR and eventual release: do not split the credential/caller migration into independently deployable partial changes. Small mechanical sub-packets may be assigned sequentially within its issue, but one integrator owns the full diff and review. B3 may develop independently in a separate prepared worktree; integration evidence must cover B2–B5 together. This plan prepares release and revert instructions without deploying.

### C. Diagnostic and MCP foundation

| ID | Task and required output | Depends on | Model / effort | Done when |
| --- | --- | --- | --- | --- |
| C1 | Implement #777 durable bounded audit using its approved storage/retention contract. Reuse existing audit infrastructure; migration only if needed. | A4, B2/B3 accepted | C / medium or default; H for schema/failure policy | Restart/persistence, retention, redaction and failure tests pass; auth failures and MCP correlation can be audited without storing raw evidence or tokens. |
| C2 | Implement #778 typed tool registry and API client, separate from transport. | A4, C1 | C / medium or default | Fake-client tests prove only approved bounded diagnostic endpoints can be called; no user-controlled URL/credential path. |
| C3 | Implement local stdio adapter around that core, startup configuration and orderly shutdown. | C2 | F / low or default | MCP initialize/list/call work; diagnostics stay off stdout; cancellation/timeouts and missing credential/backend cases return safe errors. |
| C4 | Implement #780 exact auth, bounds, sanitizer and adversarial-evidence test matrix. Use synthetic fixtures. | A4; finalize after C1–C3 | F / low or default; H reviews negative cases | Wrong-scope/missing/invalid credentials, maximum and over-limit inputs, malicious evidence and outages are covered; no live provider dependency. |
| C5 | Complete #781 local setup, provider disclosure, redacted examples, token rotation/revocation and troubleshooting. | C1–C4 accepted | R / default | Instructions match actual commands/contracts, contain no secrets, and clearly defer #779 remote access. |

If #778 adds a workspace, follow `wav-new-package` and update all specified Dockerfiles. If C1 needs Prisma changes, follow `wav-prisma-migration`, test migrations and verify drift. These are implementation triggers, not authorization to add a package/table unnecessarily.

### D. Source-drift evidence and offline validation

| ID | Task and required output | Depends on | Model / effort | Done when |
| --- | --- | --- | --- | --- |
| D1 | Add bounded drift-case and failed-job correlation readers using existing source/run/job/log data and evidence IDs. | A4, C2, C4 | C / medium or default | A `needs_remapping` source yields scoped current facts, hashes, available evidence and unknowns; a failed job yields queue/job/correlation IDs, source/run IDs when available, attempt/time/status, safe API error code/message, and adjacent correlated logs or an explicit expired/missing-evidence result. Validation errors, server failures, dependency outages, capacity requeues, and connectivity/timeouts are distinguishable. Raw request bodies, credentials, raw seller HTML and personal data are excluded; missing source, no sample and stale evidence are explicit. |
| D2 | Add parser-context reader: active adapter kind, effective mapping support, fixture/gold metadata and deployed revision. | A4, C2, C4 | F / low or default | Synthetic declarative/custom cases report the correct repair path; no fabricated test status or private paths/content leaked. |
| D3 | Implement sandboxed, bounded offline validation over approved captured fixtures with the real extractor/parser. | A4, D2 | H / high or default + review | Before/after extraction and required gold checks are reported; no network/live crawl, scripts, SSRF, arbitrary file read or production mutation. |
| D4 | Add synthetic drift fixtures and regression cases for declarative and custom adapters. | D1–D3 contracts fixed | F / low or default | Broken selector, unchanged baseline, missing fields, malformed proposal, malicious HTML and code-fix-required cases have deterministic expectations. |

D3 must disable browser network and script execution for untrusted samples and enforce resource/time limits. Never run agent-supplied JS/transforms: use the existing allowlisted transform registry. Actual parser code changes are validated through repository checks, not executed as uploaded arbitrary code by MCP. Follow the scraper-source skill for affected extraction logic/fixtures.

### E. Proposals, approval and repository handoff

| ID | Task and required output | Depends on | Model / effort | Done when |
| --- | --- | --- | --- | --- |
| E1 | Implement only #1111's mapping review storage/service slice, preserving one shared review-item model. | A4, C1 | H / high or default + review | Pending proposal has dedupe identity, evidence refs, source/baseline/revision, validation result and immutable change history; creation does not alter live mappings. |
| E2 | Add narrow proposal submission/list/detail APIs and host connector, enforcing the frozen credential boundary. | E1, D1–D4 | C / medium or default | Unauthorized requests fail; duplicates do not create repeated pending work; proposal shape/size and stale validation are checked server-side. |
| E3 | Implement human approve/reject/rollback service with atomic baseline comparison and durable audit. Eliminate active legacy agent auto-apply paths in this scope. | E2 | H / high or default + review | Concurrent/stale approvals fail safely; replay cannot reapply; rejection changes no mapping; rollback preserves history and detects intervening edits. |
| E4 | Add minimal mapping-review list/detail/actions using existing ops components and session auth. Display saved HTML as inert content only. | E3 | C / medium or default | Authenticated operator can inspect evidence and approve/reject/rollback; keyboard semantics and responsive/error states pass. No visual mapper or other review kinds required. |
| E5 | Add typed code-fix/repository handoff and draft-PR runbook. Use the existing SDLC CLI, not a new executor. | A4, D1–D4, C5 | F / low or default | Custom-adapter case yields an issue-scoped handoff with AC, fixtures, revision and checks; integration demo reaches a draft PR with authorized GitHub access. |
| E6 | Add human-managed action policy with an empty automation allowlist, shared by proposal/action entrypoints. | A4; finalize with E2/E3 | H / high or default + review | No agent can read/edit policy or self-approve; unlisted actions require authenticated approval; no direct write endpoint bypass. |

New routes follow `/internal/ops/*` and `/ops/*` ownership and canonical response envelopes; update `docs/api-routes.md`. Diagnostic read tools call bounded `/diagnostics/*` contracts only. Human approval protects proposal submission unless the owner later explicitly enables a narrowly scoped allowance for deduplicated pending proposals; live mapping changes remain per-action approval only. Draft PR creation is allowed only within the authorized issue workflow after checks. The agent cannot enable either allowance.

Read `apps/ops/AGENTS.md` and other applicable UI guidance before E4. Follow the shared Prisma migration skill for E1 if required. Broader #1111 dealer candidates, problem listings and visual mapper remain open follow-ups. Do not add a duplicate proposal database or a second observability store; #1072 integration is additive when available, not a dependency on building the full lifecycle system.

### F. Prove the complete path and prepare PRs

| ID | Task and required output | Depends on | Model / effort | Done when |
| --- | --- | --- | --- | --- |
| F1 | Run an offline local-stdio journey over synthetic drift data: inspect → propose → validate → approved proposal or code handoff. Include rejection and stale-baseline paths. | B–E accepted | C / medium or default | Captured tool/API results prove diagnosis, no pre-approval live change, audit continuity and adapter-aware decisions; CI requires no paid model. |
| F2 | Independent security/correctness review against AC, route/auth matrix and all approval entrypoints. | F1 | H / high or default + review; different vendor before merge | All critical/warning findings fixed and retested; suggestions resolved/deferred explicitly. No claim of completed review based on generated text alone. |
| F3 | Assemble AC-to-evidence links, docs, release/rollback notes and required checks; finish each issue to its draft PR. | F2 | R / default for assembly; integrator verifies/finishes | Each issue's evidence and exact command results are recorded; status is `needs-review`; no merge/deploy performed. |

Parallelism: A1/A2 can run together; after ratification B3/B5 and read-only contract/fixture preparation can run independently where file ownership permits. E1 and D work may overlap after A4 and their foundation dependencies. Keep one writer per file set and migrations serialized. Tasks depending on unmerged code stay in the same issue branch or wait for integration; do not start an ordinary issue from a stale or incompatible base.

## Test and acceptance evidence

| Acceptance condition | Required proof |
| --- | --- |
| Private boundary and scoped auth | API auth matrix plus production-like public-edge/private-network black-box tests; public product route positive checks; Bull Board assets/XHR/session checks. |
| Useful bounded diagnosis | Tool contract tests for source/run/evidence scope, empty/missing/stale data, max/over-limit inputs, deadlines/cancellation, redaction and backend outage. |
| Evidence remains untrusted | Synthetic prompt injection, secrets/PII, malicious HTML and unsafe selector/transform cases; no secrets in replies, logs, audit or stderr/stdout protocol. |
| Safe validation | Deterministic fixture/gold comparisons; browser/network/script/resource isolation; no live crawl or production writes. |
| Governed mapping changes | Deduplication, pending-state non-mutation, server-side authenticated approval, version/baseline binding, races/replay/stale validation, audit failure, rejection and rollback tests. |
| Empty automation policy | Deny by default, policy tampering and direct endpoint bypass tests; agent claims of approval have no authority. |
| Adapter-aware completion | Declarative case can reach a reviewed mapping proposal; custom case reaches a code-fix handoff and normal draft PR evidence. |
| Usable human review | Keyboard, screen-reader semantics, visible focus, contrast, mobile layout, touch targets and safe evidence rendering for E4. |

At each coherent slice run focused regression checks and `pnpm check:affected`. Before finish run `pnpm typecheck && pnpm lint && pnpm build && pnpm test`, plus issue-required manual checks. Run `pnpm test:e2e` for UI changes and built-container flows as required. Verify Prisma drift with `prisma migrate diff --exit-code` for deployed migrations. Do not replace a failing security test with a weaker expectation to keep a free worker moving.

Record exact commands, revision, results, resolved worker model/variant, reviewer identity, skipped checks and blockers. Link long logs; use synthetic evidence in PRs. Free inference quotas, GitHub authentication and production deployment permissions are separate concerns: local CI should run with mocked model responses, and only an authorized integrator handles external workflow actions.

## Implementation handoff

Recommended first action is A1 and A2 as read-only packets. Then complete A3/A4 before issuing implementation briefs. Planning itself needs no implementation issue. Once contracts are approved, use open issues and `pnpm wivwav start N` or the prepared sprint workflow; verify AC, branch from latest `origin/main`, check in, and keep commits functional and issue-scoped. Do not implement on `main`.

Worker brief template:

```text
Task: <one ID and linked open issue>
Goal: <one concrete behavior>
Profile/model/effort: <table recommendation; actual supported picker ID/variant>
Inputs: <approved contract, exact files, synthetic fixtures, relevant instructions>
Allowed edits: <owned file set; one issue scope>
Acceptance: <row's done condition and focused commands>
Constraints: no new policy decisions; no secrets/production access; no paid fallback
Stop: report ambiguity or one failed correction; do not expand scope
Return: diff/commit, AC evidence, exact checks, resolved model, limitations
```

This document is an execution map, not evidence that any implementation task is complete. At kickoff populate GitHub issue/PR links and task statuses; record substantive milestone changes here without creating a competing task tracker.
