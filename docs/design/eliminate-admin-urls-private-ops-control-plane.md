# Eliminate `/admin` URLs and the private ops control plane: decision record

Status: independent architecture review requested on #843 is complete — Claude
and Codex converged on D1-D6 with no remaining material technical
disagreement (see #843 comment thread, 2026-07-21). **Ratification is not yet
complete.** Per #843's own framing, "A human owner records D1-D6 as accepted,
revised, or rejected" is a required, outstanding step. Nothing in this
document should be read as ratified; it is the durable record of the
converged *recommendation*, written so the human owner can accept, revise, or
reject each decision without re-deriving the analysis from the issue thread.

No implementation child issue for this work has been created. #843's own
text is explicit: "Do not create implementation tickets mechanically until
D1-D6 are ratified." This document plans the child-issue graph (Section 7)
but does not open it.

Participants: Codex (OpenAI) and Claude (Anthropic) recorded signed
architecture-review comments on #843, converging fully by the second round.
This document consolidates their agreed position.

## 1. Problem and current evidence (corrected)

The owner requirement is explicit: no WivWav-owned runtime URL may use the
`/admin` namespace. The current tree confirms the problem, with two
corrections to #843's original evidence:

- `apps/api/src/app.ts` mounts `/admin`, `/admin/vehicle-identity`,
  `/admin/ai`, `/admin/config`, `/admin/logs`, `/admin/attention-snapshot`,
  and `/admin/board` (Bull Board) behind a single fail-closed
  `adminAuthPlugin` (`apps/api/src/plugins/admin-auth.ts`), keyed on
  `INTERNAL_API_SECRET`.
- **Correction:** `apps/web/src/lib/resolve-ollama-config.ts` calls
  `GET /admin/config/:key` — a keyed config *read*, not
  `/admin/config/:key/decrypt`. #843's current-evidence section overstated
  this as a decrypt call.
- **Gap found in review:** `apps/ops` has its own, separate
  `apps/ops/src/lib/resolve-ollama-config.ts`, independent of the
  `apps/web` file above. It calls the identical `GET /admin/config/:key`
  route through `apps/ops/src/lib/api-fetch.ts`, which forwards
  `INTERNAL_API_SECRET` — not through the ops BFF proxy, and not using any
  ops-only credential. It fails soft to `OLLAMA_DEFAULT_MODEL` on error, so a
  missed migration would silently degrade rather than crash, but it is a
  distinct config-read call site that both #843's original evidence and this
  document's first draft omitted. It must migrate alongside the `apps/web`
  file (Section 7) and is why `apps/ops` already holds `INTERNAL_API_SECRET`
  today, not only the future `OPS_API_SECRET` (Section 4).
- `apps/ops` never calls `/admin/*` from the browser; it proxies server-side
  through its BFF (`apps/ops/src/app/api/bff/[...path]/route.ts` and
  `apps/ops/src/app/admin/board/[[...path]]/route.ts`), injecting
  `INTERNAL_API_SECRET`. The literal `/admin/*` targets are broader than "one
  caller," though: overview, readiness, queues, runs, sources, schedules,
  refresh, logs, config, AI, field-conflicts, source-pipeline, navigation, and
  Bull Board all construct `/api/bff/admin/*` strings. They share a BFF base,
  but every literal string and its test/documentation contract migrates.
- The public route matrix also includes `/docs` (Swagger UI) and
  `/openapi.json`, not `/openapi` as #843 stated — both need an explicit
  production-exposure decision, not a hand-wave.
- `docker-compose.prod.yml` publishes API port 3001 and ops port 3002 on the
  host. No reverse-proxy/ingress contract is checked into the repository.
- `/v1/*` is the intentional public product/API-key surface and is not
  conflated with privileged controls anywhere in this design.

## 2. Converged answers to the eight review questions

**Q1 — `/internal/ops/*` vs. a narrower config scope.** Split them.
`/internal/ops/*` is the privileged operator API (queue mutation, schedule
changes, config writes, logs). `/internal/config/*` is a distinct, read-only,
least-privilege scope for server-to-server config reads. Today the only
non-ops caller of the privileged tree is `resolve-ollama-config.ts`.

**Q2 — Ops BFF namespace.** Adopt `/ops/api/*` for `apps/ops`'s browser-to-BFF
calls (rename of today's `/api/bff/*`). One ingress rule (`^/ops(/|$)`) then
gates every human-session surface.

**Q3 — Bull Board base path.** `/ops/queues/board/*` on both the ops origin
and the private API upstream, with exact path parity (Section 3).

**Q4 — Listener/deployment topology.** Do not split into separate deployment
units. Do not commit to two Fastify listeners as the default either — the
current composition root (`apps/api/src/index.ts`) is one `buildApp(...)`
and one `app.listen(...)`; route-separated listeners require duplicating
plugin lifecycle, logging, metrics, shutdown, and DB pool wiring, which is
not proportional as a default. Baseline: **one API process on the private
compose network with no raw host-published production port**, plus an
explicit edge/ingress allowlist forwarding only `/v1/*`, signed webhooks,
narrow telemetry, and explicitly approved health/docs/metrics surfaces.
`web` and `ops` reach the API over the private network directly. Fail-closed
bearer auth remains mandatory as defense-in-depth regardless of network
policy. A two-listener (or two-process) carve-out is a conditional fallback,
justified with hosting evidence in the exposure-enforcement issue, only if
the selected ingress technology cannot enforce path allowlists.

**Q5 — Aliases vs. bounded transition.** No aliases, ever. One atomic,
coordinated migration release (multiple coherent commits inside one PR/issue
are fine) so no released state of `main` carries both `/admin/*` and
`/internal/*`/`/ops/*` simultaneously. Final `/admin/*` behavior is 404,
with no redirect. Rollback is a release revert.

**Q6 — Automated proof privileged routes are unreachable publicly.** Two
layers, both required:
1. **Public-edge black-box probes** (against a compose stack simulating
   production ingress) asserting 404 for `/admin/*`, `/internal/*`, `/ops/*`,
   and private `/diagnostics/*`. 404 (not 401) proves the edge denies the
   route rather than merely rejecting a missing credential.
2. **Private-network probes** reaching the intended routes directly and
   asserting 401/503 for missing/invalid credentials — proving fail-closed
   application authorization still holds as defense-in-depth.
Plus two static guards: a CI route-dump snapshot that fails if any
public-listener route starts with a privileged prefix, and a source-grep
guard rejecting new `/admin/` literals outside an explicit allowlist (the
404 negative-test fixture and immutable historical references).

**Q7 — Reconciling #773/#775/#778/#780.** The diagnostic-gateway design
survives verbatim in shape; only the path/credential strings its assertions
name change. See Section 6.

**Q8 — Over-engineering to cut.** Automatic authenticated wake + idle
shutdown for ops (full D6 lifecycle machinery) is deferred — a Compose
profile plus documented manual start/stop satisfies the owner's
stopped-by-default requirement now without pre-building cold-start auth,
readiness polling, and idle-timeout machinery for a hosting platform that
isn't chosen yet. Separate deployment units for public/private API traffic
are also cut (Q4). A general internal RBAC system is cut in favor of three
coarse service identities (Section 4).

## 3. Recommended D1-D6 (converged, unratified)

| Decision | Recommendation | Ratification |
| --- | --- | --- |
| **D1** — Namespace ownership | `/internal/ops/*` for the privileged operator API (`OPS_API_SECRET` only); `/internal/config/*` as a distinct read-only scope accepting either `INTERNAL_API_SECRET` (`web`'s caller) or `OPS_API_SECRET` (`ops`'s caller — Section 4). No generic internal RBAC. | ☐ Accepted ☐ Revised ☐ Rejected |
| **D2** — Public vs. private API | `/v1/*` is the only intentionally public product API. Explicit public exceptions: `/health`, `/metrics` (network-scoped), `/telemetry/client-events` (rate-limited), `/webhooks/*` (signed), `/docs`, `/openapi.json` — production exposure of the last two decided at ratification. Everything else refuses the public edge. | ☐ Accepted ☐ Revised ☐ Rejected |
| **D3** — Bull Board proxy contract | Exact path parity at `/ops/queues/board/*` on both the ops origin and the private API upstream; `setBasePath('/ops/queues/board')`; no rewriting; `/admin/board` proxy deleted. | ☐ Accepted ☐ Revised ☐ Rejected |
| **D4** — Deployment/ingress enforcement | Private-networked API, no host-published production port, explicit edge allowlist; fail-closed bearer auth remains mandatory; two-listener/process split only as a conditional, evidence-justified fallback. | ☐ Accepted ☐ Revised ☐ Rejected |
| **D5** — Migration and rollback | One atomic, coordinated namespace + credential migration; no `/admin` alias at any point; rollback = revert. | ☐ Accepted ☐ Revised ☐ Rejected |
| **D6** — On-demand ops lifecycle | Stopped-by-default via a Compose profile + documented manual start/stop is in scope now. Automatic authenticated wake, idle shutdown, and cold-start auth defer to a hosting-specific follow-up; no public wake endpoint is ever introduced. | ☐ Accepted ☐ Revised ☐ Rejected |

**The human owner must check one box per row (in a comment on #843) before
any implementation child issue is created or marked `status:ready`.**

## 4. Credential model

Three coarse service identities replace the single `INTERNAL_API_SECRET`
that today unlocks every privileged surface:

- **`OPS_API_SECRET`** — held by `api` and `ops`. Accepted on
  `/internal/ops/*`, Bull Board's private upstream, and (see reconciliation
  below) `/internal/config/*`.
- **`INTERNAL_API_SECRET`** — held by `api` and `web`. Accepted on the
  existing server-to-server `/v1` bypass and on read-only
  `/internal/config/*`. **Never** accepted on `/internal/ops/*` — this is
  the change that stops a compromised `web` container from escalating to
  the operator control plane.
- **`DIAGNOSTIC_API_SECRET`** — accepted only by `/diagnostics/*` (#773).
  The intentional higher-privilege asymmetric credential also accepted
  there is `OPS_API_SECRET`, not `INTERNAL_API_SECRET` — `web` must never
  hold diagnostic-adjacent operator authority.

This is three coarse identities, not a general RBAC system; that ceiling is
intentional (Q8).

**Reconciling the `apps/ops` config-read caller.** Section 1 identified a
gap: `apps/ops/src/lib/resolve-ollama-config.ts` reads `/admin/config/:key`
today using `INTERNAL_API_SECRET` (via `apps/ops/src/lib/api-fetch.ts`),
independently of `apps/web`'s equivalent file and of the ops BFF proxy. Two
options were considered; this document recommends the first:

1. **(Recommended) `ops` uses `OPS_API_SECRET` for its config read, not
   `INTERNAL_API_SECRET`.** `ops` already holds `OPS_API_SECRET` for
   `/internal/ops/*` and Bull Board, so this adds no new secret to the `ops`
   container — it only stops issuing `INTERNAL_API_SECRET` from `ops`.
   `/internal/config/*` must then accept **either** `INTERNAL_API_SECRET`
   (from `web`) **or** `OPS_API_SECRET` (from `ops`) — both are read-only
   grants against that scope, so accepting both credentials there does not
   widen `/internal/config/*`'s privilege, and `ops` no longer needs to hold
   `INTERNAL_API_SECRET` at all once its BFF and this call site both use
   `OPS_API_SECRET`.
2. **(Rejected as messier) `ops` keeps `INTERNAL_API_SECRET` for this one
   call site.** Leaves `ops` holding two overlapping secrets for no
   functional gain and contradicts the "web and ops each hold exactly one
   privileged secret" simplicity goal of the three-identity model.

Migration must update this call site alongside `apps/web`'s (Section 7);
until it lands, `ops` legitimately holds `INTERNAL_API_SECRET` as it does
today.

## 5. Bull Board base-path design and test matrix

Upstream (API, private network only):

```ts
serverAdapter.setBasePath('/ops/queues/board')
app.register(serverAdapter.registerPlugin(), { prefix: '/ops/queues/board' })
```

Ops BFF (`apps/ops/src/app/ops/queues/board/[[...path]]/route.ts`, replacing
today's `apps/ops/src/app/admin/board/[[...path]]/route.ts`): forwards every
method to `${PRIVATE_API_BASE}/ops/queues/board/${path}${search}`, injecting
`OPS_API_SECRET` server-side after verifying the ops session — same shape as
today's `proxyToApi`/`buildUpstreamPath` helpers, new path and secret.

Path parity is what buys "no rewriting": Bull Board's HTML emits
`<script src="/ops/queues/board/static/...">`; the browser requests that path
from the ops origin; the BFF forwards the identical path upstream.

Required test matrix (mirrors today's `admin/board` proxy tests at the new
path):

- Authenticated HTML GET → 200, asset links point at `/ops/queues/board/…`.
- Authenticated static asset GET → 200.
- Authenticated XHR to `/ops/queues/board/api/queues` → 200, queue JSON.
- Nested path (`/ops/queues/board/queue/<name>`) → 200.
- Unauthenticated navigation → redirect to login with the target path
  preserved.
- Unauthenticated subresource XHR → 401 JSON.
- Direct GET to the public API host for `/ops/queues/board/*` → 404 (edge
  denial, Section 6).

## 6. Production network/ingress enforcement and black-box tests

Baseline (D4): the API container has no raw host-published port in
production. `docker-compose.prod.yml`'s current `ports: ["3001:3001"]` on
`api` is removed; `web` and `ops` reach `api` over the private compose
network via `API_INTERNAL_URL`, unchanged from today's pattern. A
documented edge gateway (reverse proxy — the specific technology is a
maintainer/hosting call outside this document's scope) joins the private
network and forwards only the explicit public allowlist: `/v1/*`, signed
webhooks, `/telemetry/client-events`, `/health`, and whichever of
`/metrics`/`/docs`/`/openapi.json` D2 ratifies for production exposure.
`/internal/*`, `/ops/*` (including `/ops/queues/board/*`), and private
`/diagnostics/*` are never forwarded.

Black-box negative tests, run in CI against a compose stack that simulates
this topology:

- **Edge probes** (simulating an external client hitting the public
  ingress): `/admin/*`, `/internal/ops/*`, `/internal/config/*`, `/ops/*`,
  `/ops/queues/board/*`, and private `/diagnostics/*` all return 404.
- **Private-network probes** (simulating a caller already inside the
  private network, e.g. a compromised sibling container): the same routes
  are reachable but return 401/503 without a valid credential, and 200/etc.
  with the correct scoped credential — proving fail-closed application
  authorization holds independently of network policy.
- **Static guards**: a CI route-dump snapshot fails if any route registered
  on the public-facing surface starts with `/admin`, `/internal`, `/ops`, or
  `/diagnostics`; a source-grep guard rejects new non-test `/admin/` string
  literals outside a short explicit allowlist (the retired-route 404 test
  fixture, and any immutable historical/third-party reference).

## 7. Migration and rollback

One atomic, coordinated namespace-and-credential migration (multiple
coherent commits inside one PR are fine; no released state of `main` may
carry both `/admin/*` and the new namespace):

1. Split `admin-auth.ts` into two auth plugins: an ops-auth plugin keyed on
   `OPS_API_SECRET` and an internal-config-auth plugin that accepts
   **either** `INTERNAL_API_SECRET` **or** `OPS_API_SECRET` (Section 4 — both
   are read-only-scoped grants against config, so accepting either does not
   widen the scope).
2. Mount `/internal/ops/*` (ops-auth, `OPS_API_SECRET` only) and
   `/internal/config/*` (internal-config-auth, either secret) in
   `apps/api/src/app.ts`, replacing the `/admin` mounts in the same change.
3. Migrate every `apps/ops` BFF client string off `/admin/*` (overview,
   readiness, queues, runs, sources, schedules, refresh, logs, config, AI,
   field-conflicts, source-pipeline) to `/internal/ops/*` via the renamed
   `/ops/api/*` BFF prefix; update `apps/ops/src/middleware.ts`'s matcher.
4. Update `apps/web/src/lib/resolve-ollama-config.ts` to call
   `/internal/config/:key` using `INTERNAL_API_SECRET` (no `OPS_API_SECRET`
   in `web`, ever).
5. Update `apps/ops/src/lib/resolve-ollama-config.ts` (a separate file from
   step 4's `apps/web` one, found during review — Section 1) to call
   `/internal/config/:key` and switch `apps/ops/src/lib/api-fetch.ts` to
   forward `OPS_API_SECRET` instead of `INTERNAL_API_SECRET`. After this
   step, `ops` no longer needs `INTERNAL_API_SECRET` at all — it holds only
   `OPS_API_SECRET`, satisfying the one-secret-per-service-identity goal.
6. Bull Board: `setBasePath('/ops/queues/board')` upstream; add
   `apps/ops/src/app/ops/queues/board/[[...path]]/route.ts`; delete
   `apps/ops/src/app/admin/board/[[...path]]/route.ts`.
7. Remove all `/admin/*` mounts and the old `admin-auth.ts` from
   `apps/api/src/app.ts` in the same release — final state returns 404 with
   no redirect or alias.
8. `docker-compose.prod.yml`: drop the API's host port publication; wire
   `OPS_API_SECRET` into `api`/`ops` and remove `ops`'s
   `INTERNAL_API_SECRET` entry; keep `INTERNAL_API_SECRET` in `api`/`web`.
9. Update `docs/api-routes.md`'s route table and admin-auth-boundary section
   to the new namespace and credential model.
10. Land the regression guards from Section 6 in the same release so the new
    boundary is enforced mechanically from day one, not just documented.

**Rollback:** revert the coordinated release. There is no data migration and
no on-disk state change, so revert is safe at any point up to the release.

**Pre-cutover verification:** the full black-box suite from Section 6 runs
against the compose stack in CI with the new configuration and must pass
before the migration PR merges.

## 8. Diagnostic gateway reconciliation (#773 / #775 / #778 / #780)

The asymmetric read-only diagnostic credential model from #757 is preserved
verbatim; only the path/credential strings its tests assert against change.

- **#773 (`DIAGNOSTIC_API_SECRET` auth scope).** Its acceptance criteria
  currently read "rejected on `/admin/*`." Reconciled wording: rejected on
  `/internal/ops/*` and `/internal/config/*`. The intentional higher-privilege
  asymmetric credential accepted on `/diagnostics/*` is `OPS_API_SECRET`, not
  `INTERNAL_API_SECRET` (Section 4) — `web`'s credential must never grant
  diagnostic-adjacent operator authority.
- **#775 (`/diagnostics/*` routes).** Binds to the private network,
  alongside `/internal/ops/*` and `/internal/config/*` — not to any public
  listener. Remote (non-ops-BFF, e.g. desktop-app-over-tunnel) transport is
  an explicitly separate follow-up issue, not part of this reconciliation.
- **#778 (transport-neutral MCP core + stdio adapter).** No path changes;
  it targets `/diagnostics/*` regardless of which network segment serves it.
  Must not call any `/admin` wrapper — any read-only capability it needs
  goes through the bounded `/diagnostics/*` contract only.
- **#780 (contract tests).** Mechanical rewrite: authorization tests assert
  `DIAGNOSTIC_API_SECRET` works on `/diagnostics/*` and is rejected on
  `/internal/ops/*` and `/internal/config/*`; the intentional-asymmetry test
  asserts `OPS_API_SECRET` (not `INTERNAL_API_SECRET`) also works on
  `/diagnostics/*`. Redaction, bounds, and adversarial-telemetry tests are
  unaffected.

**Sequence:** these four issues are paused — no implementation proceeds
against their current `/admin`-referencing AC — until D1-D6 are ratified and
this reconciliation is applied to their acceptance criteria. None receives
`status:ready` before that.

## 9. Mechanical enforcement after ratification

An agent reminder alone is not a security control. After ratification:

- A `check:boundaries` repository script (not a bespoke ESLint rule, since
  the policy spans TypeScript, Next.js route paths, Markdown, and Compose)
  rejects WivWav-owned `/admin` URL literals, rejects `OPS_API_SECRET`
  references in `apps/web`, and asserts production Compose does not
  host-publish the raw API port. It runs in normal lint/CI/finish paths.
- API contract tests prove the credential-scope boundaries in Section 4 and
  that retired `/admin/*` routes return 404.
- Deployment black-box tests prove the two-layer edge/private-network split
  in Section 6.
- `docs/api-routes.md` stays canonical for the ratified route table; add
  concise pointers to this document from `AGENTS.md`, `.claude/core.md`,
  `reviewer.md`, and `docs-accuracy.md` so future route additions are
  checked against the boundary. No new dedicated review agent is needed —
  the existing mandatory reviewer and route-triggered docs-accuracy reviewer
  are sufficient once they point at these deterministic checks.

## 10. Planned child-issue graph (not yet created)

Per #843's explicit instruction, none of these are created until D1-D6 are
ratified (Section 3) and none receives `status:ready` at creation time if it
depends on a still-open predecessor.

```
A  This document + #843 ratification comment (doc-only; #843 stays open)
│
├─► B  Atomic namespace + credential migration (Section 7), one coordinated
│      PR: split admin-auth.ts into ops-auth/internal-config-auth, mount
│      /internal/ops/*, /internal/config/*, migrate every apps/ops BFF
│      client string, web's resolve-ollama-config.ts, Bull Board proxy,
│      remove /admin/* entirely (final state: 404), route tests,
│      docs/api-routes.md. Depends on: A (ratified D1, D3, D5).
│
├─► C  Production exposure enforcement (Section 6): unpublish the API host
│      port, explicit edge allowlist, production policy for /docs,
│      /openapi.json, /metrics, /health, edge + private-network black-box
│      tests. Depends on: A (ratified D2, D4); may run in parallel with B
│      once D4 is ratified, but #843 does not close until both land.
│
├─► D  Regression guard (Section 9): check:boundaries script, CI route-dump
│      guard, source-grep guard. May fold into B if trivially small once
│      scoped. Depends on: A; typically lands alongside B.
│
└─► E  Ops stopped-by-default (D6): Compose profile + documented manual
       start/stop. No public wake endpoint. Depends on: A (ratified D6).

H  (parallel to B-E, depends only on A) Reconcile #773/#775/#778/#780
   acceptance criteria per Section 8; unblocks their implementation once
   applied. Does not itself implement the diagnostic gateway.

F  (deferred, does not gate #843) Automatic authenticated wake + idle
   shutdown for ops. Opens only after a hosting control plane is selected.
   No public wake endpoint, ever.
```

**Closure order:** #843 tracks the whole namespace-elimination contract and
closes last, only after ratification (A) and B, C, D, E, H are all complete
with evidence. F is explicitly out of #843's closure path.

## 11. Milestone

Tracked under milestone "Private Ops Control Plane" (#23), currently holding
only #843. Child issues B/C/D/E/H join this milestone when created after
ratification; #843 remains the tracking issue and closes last.
