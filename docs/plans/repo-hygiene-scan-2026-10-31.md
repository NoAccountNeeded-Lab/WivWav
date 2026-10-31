# WivWav repository hygiene scan, 2026-10-31

Read-only scan of `apps/*`, `packages/*`, `docker-compose*.yml`, `docker/`, `scripts/`, `.github/`, plus `e2e/` and `.devcontainer/` where they repeat configuration. Skipped: `node_modules`, fixtures, `spikes/`, generated code, and `apps/web` edits (findings only).

Baseline: `main` at `d9ef8027`, which already contains part of #1225. The sibling branch `claude/secure-ai-ops-mvp-0ac0fd` was not inspected, so findings about compose and e2e defaults may already be changing there. Treat S1 to S3 as input to that branch, not as separate work.

Method and limits: grep and targeted reading only. The first version applied the audit checklists by hand. A second pass (section 5) then ran `ponytail:ponytail-audit` and `engineering:tech-debt` as proper passes on the highest-risk code. `security-review` was **not** run: it targets pending branch changes, and this branch is docs only. Nothing was executed, so every "verify" item is a hypothesis. No secret value appears here; locations are file:line only. A shared 64-character hex string is called "the dev default hex".

Effort: S under 2 hours, M about a day, L multiple days. Risk is the risk of making the change. Quick wins are marked **QW**.

## Top 10 by value over effort

| Rank | ID | Finding | Effort | Risk |
|---|---|---|---|---|
| 1 | S1 | One dev default hex is reused for 3 different identities in 12 places | S | Low, **QW** |
| 2 | S2 | Operator, diagnostic and worker auth fail open when no secret is set and `NODE_ENV` is not `production` | S | Medium, **QW** |
| 3 | S3 | Bearer tokens compared with `===` or `!==` in 5 places; one timing-safe helper exists in `apps/ops` | S | Low, **QW** |
| 4 | S4 | Dev compose publishes Postgres, Valkey and Meilisearch on all interfaces with trivial credentials | S | Low, **QW** |
| 5 | M1 | Ollama default URL written out in 5 places across 4 packages | S | Low, **QW** |
| 6 | D1 | `parseMileage` copied verbatim into 4 scraper sources, `parsePrice` into 3, `escapeRegExp` into 2 | S | Low, **QW** |
| 7 | D2 | Five auth plugins and hooks repeat the same bearer check with different rules | M | Medium |
| 8 | M2 | `WivWav/1.0 (wivwav.com)` user agent repeated 18 times in 14 files; NHTSA base URLs per handler | S | Low, **QW** |
| 9 | S5 | Environment variables read directly outside the validated config schema (feature flags, thresholds) | M | Medium |
| 10 | G1 | 338 `console.*` calls outside tests despite `@wivwav/logger` | M | Low |

## Counts

| Area | Findings | Quick wins |
|---|---|---|
| 1. Secrets and configuration (S) | 8 | 4 |
| 2. Magic values (M) | 8 | 4 |
| 3. Duplication and reuse (D) | 9 | 4 |
| 4. Design quality (G) | 9 | 2 |
| 5. Second-pass additions (N) | 4 | 1 |
| Total | 38 | 15 |

---

## 1. Secrets and configuration

### Inventory and recommended home

Bootstrap secrets cannot live in the database: the API needs them before it can read the database, or they protect the database itself.

| Item | Where it lives now | Recommended home | Why |
|---|---|---|---|
| `DATABASE_URL`, `POSTGRES_PASSWORD` | compose (`docker-compose.yml:9,59,76`), `.devcontainer/devcontainer.json:17`, `e2e/support/compose.ts:31`, `ci.yml:349,384` | Environment, secret store in production | Bootstrap: cannot be read from the database it opens |
| `CONFIG_ENCRYPTION_SECRET` | `apps/api/src/config.ts:63`, compose default `docker-compose.yml:84`, devcontainer `:26`, prod compose `docker-compose.prod.yml` | Environment, secret store in production | It is the key to the encrypted table; storing it there is circular. Also needs a rotation story (see S7) |
| `INTERNAL_API_SECRET`, `OPS_API_SECRET`, `WORKER_API_SECRET`, `DIAGNOSTIC_API_SECRET` | `apps/api/src/config.ts:68-75`, `.env.example` files, compose, devcontainer, e2e | Environment per service, each service gets only its own | Authenticate callers before any database access; the worker and web must also hold them without the database |
| `OPS_SESSION_SECRET`, `OPS_ADMIN_PASSWORD` | `apps/ops/src/lib/session.ts:22,94`, compose `:227,231`, devcontainer `:28,30` | Environment now; later replace the shared password with OIDC (already the stated upgrade path in `session.ts`) | `apps/ops` has no database access by design |
| `MEILISEARCH_API_KEY` / `MEILI_MASTER_KEY` | `docker-compose.yml:38,79`, `ci.yml:362,386`, `apps/api/.env.example:9`, devcontainer `:19`, test default `packages/search/src/index.integration.test.ts:15` | Environment | Bootstrap for search; production already requires it (`docker-compose.prod.yml`) |
| `LOKI_GATEWAY_TOKEN`, `LOKI_AUTHORIZATION` | `docker-compose.yml:286`, `apps/api/src/config.ts:36` | Environment | Shared with a gateway container that cannot read the database |
| `GRAFANA_API_TOKEN`, `SENTRY_ISSUES_AUTH_TOKEN`, `STRIPE_WEBHOOK_SECRET` | `apps/api/src/config.ts:44,51,79` | **Encrypted database config** (best candidates) | Third-party credentials, optional, operator-rotatable without redeploy; the route already degrades when unset. Needs the `ConfigEntry` secret type and `CONFIG_ENCRYPTION_SECRET` |
| `GOOGLE_PLACES_API_KEY` | `apps/worker/src/handlers/dealer-enrich.ts:113` | Encrypted database config, delivered to the worker via the existing job payload or `/internal/config` | Third-party key read ad hoc from `process.env` by a worker that has no database |
| `SENTRY_AUTH_TOKEN` | `docker/web/Dockerfile:60` (Docker build secret) | Keep as build secret | Build-time only; already handled correctly |
| `TURBO_TOKEN`, `GITHUB_TOKEN` | `.github/workflows/*.yml` | GitHub Actions secrets | Already correct |
| `WORKER_TOKEN` | `docker-compose.yml:137`, `docker-compose.prod.yml`, `Makefile` | Environment, must equal `WORKER_API_SECRET` | Name drift, see S6 |

Answer to the user's question: **no for authentication secrets, yes for optional third-party credentials.** Only the three or four third-party keys above gain anything from the encrypted table, and only if an operator would actually rotate them at runtime. Everything that authenticates a service-to-service call stays in the environment.

### Findings

**S1. One dev default hex reused for three identities, 12 places. Effort S, risk low. QW.**
The same default value is the dev `INTERNAL_API_SECRET`, the `WORKER_TOKEN` fallback, and `OPS_SESSION_SECRET` (three identities): `docker-compose.yml:85,137,193,222,227`. The e2e stack and devcontainer repeat it: `e2e/docker-compose.e2e.yml:27,37`, `e2e/support/compose.ts:19`, `.devcontainer/devcontainer.json:27,28`. A second hex is `CONFIG_ENCRYPTION_SECRET` (`docker-compose.yml:84`, devcontainer `:26`). This defeats the identity separation #1225 adds. The config schema rejects equal secrets (`apps/api/src/config.ts:105-113`) but these compose defaults supply equal values. It is also a published key for any exposed dev stack.
Fix: one `.env.dev` (committed, clearly named, fake values, distinct per identity) loaded by compose, devcontainer and e2e through `env_file`; no `:-<hex>` fallbacks inline. Alternatively generate per-checkout values in `make dev`. Fold into the #1225 branch.

**S2. Authentication fails open outside production. Effort S, risk medium. QW.**
`apps/api/src/plugins/ops-auth.ts:20-22` documents that with no secret configured and `NODE_ENV` not `production`, requests pass unauthenticated. `NODE_ENV` defaults to `development` (`apps/api/src/config.ts:10`). A production container started without `NODE_ENV=production` therefore serves operator routes with no authentication. Verify: `grep NODE_ENV docker/api/Dockerfile docker-compose.prod.yml`. `internal-config.ts:19-24` also skips the check when no secret is set outside production; the other plugins were not read in full, so verify.
Fix: fail closed everywhere; tests and dev set explicit dummy secrets (S1 gives them). Keep the permissive path only behind an explicit `ALLOW_UNAUTHENTICATED_DEV=true` flag that is refused when `DATABASE_URL` is not localhost, or remove it.

**S3. Non-constant-time secret comparison, 5 places. Effort S, risk low. QW.**
`apps/api/src/plugins/admin-auth.ts:33`, `ops-auth.ts:50`, `diagnostic-auth.ts:74-75`, `api-key-auth.ts:86`, `routes/internal-config.ts:23`. `apps/ops/src/lib/session.ts:73-81` already has `constantTimeStringsEqual` (hash both sides, then `timingSafeEqual`). Practical exposure is low on a private network, but the helper already exists.
Fix: move the helper to `packages/types` or a new small `packages/auth`-style util, use it in all five API places. Combine with D2.

**S4. Dev compose publishes data stores on all interfaces. Effort S, risk low. QW.**
`docker-compose.yml:12` (Postgres, password `wav`), `:25` (Valkey, no password), `:42` (Meilisearch, key is `wav_master_key`), `:172` (Ollama). On a laptop on public Wi-Fi, or the Mac Mini on the home network, these are reachable by anything on the network. Verify whether the Mac Mini runs this file or only the prod file; `docker-compose.prod.yml` publishes only 3000, 3001, 3002 (still all interfaces, also worth binding as needed).
Fix: prefix every published port with `127.0.0.1:`.

**S5. Environment variables read outside the validated schema. Effort M, risk medium.**
`apps/api/src/config.ts` validates, but these bypass it: `apps/api/src/lib/meili.ts:9-11` (key and host, with a second `localhost:7700` default), `jobs/meilisearch-sync.ts:126-128` and `routes/internal-scraper.ts:83` (`PUBLISH_GATE_STRICT`, also an operator setting, so two sources of truth with a third copy of the string `'true'` comparison), `routes/listings.ts:44` (`WIVWAV_SEMANTIC_EVIDENCE_MIN_CONFIDENCE`), `services/listing-facets.ts:39` (`WAV_SHOPPING_FILTERS_ENABLED`, already in the schema at `config.ts:16`), `apps/worker/src/index.ts:108`, `apps/worker/src/handlers/dealer-enrich.ts:113`, `packages/agents/src/*` (`AGENTS_*` family, 6 reads). A typo in any of these silently falls back.
Fix: route them through `loadConfig()` and inject; for `PUBLISH_GATE_STRICT` pick one home (the operator setting) and delete the env fallback. Do this per app in separate PRs.

**S6. Credential naming drift. Effort S, risk low.**
Worker credential is `WORKER_TOKEN` in compose and `Makefile`, `WORKER_API_SECRET` in `apps/api/src/config.ts:70`, with a comment saying "match the coordinator's `INTERNAL_API_SECRET`" at `apps/worker/src/config.ts:12` that #1225 has made false. `INTERNAL_API_SECRET` and `OPS_API_SECRET` are accepted interchangeably on some routes (`api-key-auth.ts:70,86`, `internal-config.ts:19-24`), so "who may call what" is spread over five files.
Fix: rename to one name each, update the stale comment, add a table to `docs/ops/` of identity → routes. Update `.env.example` files in the same change.

**S7. No rotation or key-id story for `CONFIG_ENCRYPTION_SECRET`. Effort M, risk high.**
`ConfigEntry` (`packages/db/prisma/schema.prisma:1211`) stores `encryptedValue` and `hint` with AES-256-GCM (`apps/api/src/services/config-service.ts:23`) and a single key, no key id column. Changing the env value makes every stored secret unreadable. `scripts/restore-drill.sh` proves backups restore with the right key and fail with a wrong one, which is good, but there is no re-encrypt path.
Fix before moving any further third-party keys into the table: add a `keyId` column and a re-encrypt script. Do not do this before there is more than one stored secret.

**S8. Local-only test defaults duplicated. Effort S, risk low.**
`wav_master_key` appears in `ci.yml:362,386`, `docker-compose.yml:38,79`, `.devcontainer/devcontainer.json:19`, `apps/api/.env.example:9`, `packages/search/src/index.integration.test.ts:15` and `apps/api/src/pipeline/fixture-to-facets.integration.test.ts:134`. `changeme-local-dev-password` appears in compose, devcontainer and `docs/ops/quick-start.md:64`. Not dangerous but any change needs six edits. Resolved by S1's single dev env file plus a CI `env:` block that reads it.

---

## 2. Magic values

Most timeouts are already named constants. The gaps are duplication of the same value in several packages, and values that operators would want to tune.

### API (`apps/api`)

**M1. Ollama default URL in 5 places. Effort S, risk low. QW. Constant, plus env.**
`apps/api/src/config.ts:32`, `apps/api/src/ai/ollama-provider.ts:21`, `packages/agents/src/provider.ts:32`, `packages/agents/src/cli.ts:18`, `apps/ops/src/lib/resolve-ollama-config.ts:5`. Also two different env names (`OLLAMA_BASE_URL` for api and ops, `AGENTS_OLLAMA_BASE_URL` for agents). Export one `DEFAULT_OLLAMA_BASE_URL` from `packages/types`, use one env name.

**M3. Probe and proxy timeouts scattered. Effort S, risk low. Constants.**
`routes/health.ts:24` (1500), `ai/ollama-provider.ts:3` (1500), `routes/admin-ai.ts:109,123` (2000, inline), `routes/metrics.ts:255` (inline), `routes/admin-logs.ts:110` (4_000 inline), `services/sentry-issues-client.ts:53` and `grafana-alerts-client.ts:42` (8_000 each), `services/loki-client.ts:179` (3_000), `services/vin-decoder.ts:37` (5000). One `HTTP_TIMEOUTS` object (probe, proxy, upstream) in `apps/api/src/lib/`, or use the shared fetch helper from D4.

**M4. Job limits and windows. Effort S, risk low. Mixed.**
`jobs/listing-quality-audit.ts:69-72` (batch 500, window 30 days), `jobs/meilisearch-sync.ts:13,15` (15 s, 10 minutes), `config.ts:93,100` (`WORKER_JOB_TIMEOUT_MS` 45 minutes, `JOB_RUN_MAX_AGE_MS` 6 hours, already env). 63 module-level numeric constants exist in `jobs/`, `routes/` and `services/`; they are named, which is acceptable. Only the operator-relevant ones (audit window, reaper age, gate thresholds) should become `getOperatorSetting` values, and `PUBLISH_GATE_STRICT` already is.

### Worker (`apps/worker`)

**M2. User agent and NHTSA URLs repeated per handler. Effort S, risk low. QW. Constants.**
`WivWav/1.0 (wivwav.com)` appears 18 times in 14 files (`apps/worker/src/handlers/*.ts`, `apps/api/src/services/vin-decoder.ts:36`). NHTSA hosts are written per handler: `nhtsa-recalls.ts:13`, `nhtsa-complaints.ts:12`, `nhtsa-investigations.ts:13-14`, `nhtsa-safety-ratings.ts:12`, `nhtsa-manufacturer-communications.ts:15-16`, `vin-enrich.ts:13`, and again in `apps/api/src/services/vin-decoder.ts:3`. Timeouts differ for no reason: 10_000 in two handlers, `8000` in `model-research.ts:54`. The version is hard-coded and will drift from `package.json`.
Fix: `apps/worker/src/lib/http.ts` exports `USER_AGENT`, `NHTSA_ENDPOINTS` and `fetchUpstream` (see D4); API reuses the constant from `packages/types`.

**M5. Queue names as string literals. Effort S, risk medium. Constants.**
`apps/worker/src/index.ts:48-60` registers `'source-scrape'` and others by literal, with a comment explaining the worker avoids importing `@wivwav/queue` because it pulls in bullmq. The registry (`packages/queue/src/queues.ts`) and the literals can drift silently. Fix: move the `QUEUES` string map into `packages/types` (no heavy dependencies) and re-export it from `packages/queue`; the worker then imports the names from types.

**M6. Retry and heartbeat numbers. Effort S, risk low. Constants / config.**
`apps/worker/src/ws-client.ts:26-28` (15 s, 1 s, 30 s) are named; `http-client.ts` has defaults of 3 and 300 in doc comments. `scraper-sources/src/util/network-retry.ts:21-23` has its own defaults of 3 and 1000. See D3 for merging.

### Scraper sources (`packages/scraper-sources`)

**M7. Per-source copies of the same timeouts and selectors. Effort S, risk low. Constants.**
`REQUEST_TIMEOUT_MS = 15_000` in `mobility-van-sales-fetch.ts:6`, `ams-vans-classifieds.ts:19`, `ebay-motors.ts:27`; `NAVIGATION_TIMEOUT_MS = 30_000` in `freedom-motors.ts:17` and `superior-van.ts:18`; inline `{ timeout: 15_000 }` three times each in those two files (`freedom-motors.ts:154,193,268`, `superior-van.ts:121,163,250`). Fix: a `source-defaults.ts` with `DEFAULT_REQUEST_TIMEOUT_MS`, `DEFAULT_NAVIGATION_TIMEOUT_MS`, `CARD_WAIT_TIMEOUT_MS`; sources override only when different. Per-source crawl delays and politeness settings are genuine per-source configuration and belong in the source registry, which is where `source-registry` already lives.

### Ops and web

**M8. Polling intervals and UI delays inline. Effort S, risk low. Constants.**
`apps/ops/src/app/ops/schedules/SchedulesClient.tsx:114,137,150,175` (500 ms refresh), `QueuesClient.tsx:321`, `RefreshListingsClient.tsx:106`, `SourcePipelineClient.tsx:123` (1000 ms), `logs/LogsClient.tsx:305` (400 ms debounce), `SourcePipelineClient.tsx:38` (35 s) versus the API's 30 s (`routes/admin-ai.ts:51`). `apps/ops/src/app/ops/logs/LogsClient.tsx:495` hard-codes `http://localhost:3003` in a link; `apps/ops/src/lib/api-url.ts:1` hard-codes `http://localhost:4001`. One `ops-timing.ts` and one `GRAFANA_PUBLIC_URL` setting.

**Config versus constants summary.** Environment or operator setting: the Ollama URL, the publish gate, the audit window, the reaper age, per-source crawl delays, the Grafana link. Plain constants: user agent, NHTSA hosts, all request timeouts, UI delays, queue names, batch sizes.

---

## 3. Duplication and reuse

**D1. Scraper parsing helpers copied verbatim. Effort S, risk low. QW.**
`parseMileage` identical in `mobilityworks.ts:476`, `superior-van.ts:523`, `freedom-motors.ts:486`, `blvd-parser.ts:238`; `parsePrice` in `mobilityworks.ts:481`, `superior-van.ts:528`, `blvd-parser.ts:243`; a related version in `field-transforms.ts:28` and `mobility-van-sales-parser.ts:215-222`; `escapeRegExp` in `blvd-parser.ts:293` and `superior-van.ts:396`; `asRecord` in `ams-vans-classifieds.ts:330` and `source-listing-dates.ts:63`. Fix: one `sources/parse-helpers.ts` with tests, import everywhere. Check each copy still matches before merging (the grep showed three identical bodies).

**D2. Five bearer-check implementations. Effort M, risk medium.**
`plugins/admin-auth.ts` (45 lines), `ops-auth.ts` (62), `diagnostic-auth.ts` (88), `api-key-auth.ts` (177), `routes/internal-config.ts:19-24`. Each re-implements "read header, compare, fail with 401 or 503" with different not-configured behaviour and different error codes. Fix: one `requireBearer({ secrets, onMissing })` Fastify hook factory in `apps/api/src/plugins/`, plus constant-time compare (S3). Collapse the identity policy into a table so the rules are readable. High value after #1225 lands, because it is the thing most likely to drift.

**D3. Two retry and backoff implementations, three sleep helpers. Effort S, risk low.**
`apps/worker/src/http-client.ts:25,61-90` (full jitter, exponential), `packages/scraper-sources/src/util/network-retry.ts:30-45` (linear plus jitter), `ws-client.ts:34-35` (own jittered backoff). `apps/api/src/util/jitter-sleep.ts` and `packages/scraper-sources/src/util/jitter-sleep.ts` are the same function (the second adds stderr logging). Fix: a small `retry`/`sleep`/`jitter` module in `packages/types` or a new `packages/http` that both use. Do not change backoff behaviour in the same PR.

**D4. Four HTTP helpers with a timeout. Effort M, risk medium.**
`apps/ops/src/lib/fetch-json.ts:18`, `fetch-with-timeout.ts:1`, `api-fetch.ts` (ops) and `apps/web/src/lib/api-fetch.ts` (differ by about 29 diff lines; both build an authorization header for the right identity), `apps/api/src/util/safe-fetch.ts:60`, plus a local `fetchJson` in `RefreshListingsClient.tsx:261` and hand-rolled `fetch` + `AbortSignal.timeout` in about 12 worker and API places. Fix: a shared `fetchWithTimeout(url, { timeoutMs, headers })` in `packages/types` (or `packages/http`) and make worker handlers call it. Do not touch `apps/web` here; report web's `api-fetch.ts` to the web-redesign session.

**D5. `isRecord` / `asRecord` in 6 files. Effort S, risk low. QW.**
`packages/db/src/lib/operator-intent.ts:55`, `apps/api/src/routes/internal-ops-problem-aggregate.ts:92`, `routes/admin-attention.ts:37`, `routes/diagnostics/safe-pick.ts:11`, `apps/ops/src/app/ops/workers/workers-data.ts:70`, and the `asRecord` pair in D1. Put one `isRecord` in `packages/types` and import it.

**D6. `parsePositiveInt` twice in the worker. Effort S, risk low. QW.**
`apps/worker/src/config.ts:44` and `apps/worker/src/index.ts:110` (`parsePositiveIntOr`). Use the config one; read `WORKER_SHUTDOWN_GRACE_MS` in `loadWorkerConfig`. Rolls into S5.

**D7. Dockerfiles repeat package copy lists. Effort M, risk medium.**
`docker/api` (20 `COPY packages/` lines), `web` (14), `dev` (14), `worker` (10), `migrate` (7), `ops` (6). `AGENTS.md` already tells contributors to hand-edit all of them when adding a package, which is the symptom. Fix: `turbo prune --docker` per app (the Dockerfile stage pattern turbo documents) so dependencies come from the workspace graph. Needs a trial build of each image, so treat as its own PR.

**D8. CI environment repeated. Effort S, risk low.**
`.github/workflows/ci.yml` repeats the `TURBO_TOKEN`/`TURBO_TEAM` env block at `:187,291,393`, the remote-cache echo blocks at `:334-337,464-467`, and the Postgres/Meilisearch service definitions and `DATABASE_URL` at `:349-386`. Fix: a composite action for setup (Node, pnpm, turbo env) and a single env block. Eight Node/pnpm setup lines are repeated.

**D9. Two `ConfigEntry` readers. Effort S, risk low.**
`packages/agents/src/config-client.ts:3-8` calls the API with the ops secret, and `apps/api/src/routes/internal-config.ts` serves it with its own auth hook. Fine in principle, but the agents package reads `OPS_API_SECRET` directly from `process.env` (`config-client.ts:4`), spreading the ops identity into a library package that should not hold operator credentials. Pass the credential in as a parameter and give agents the narrower `INTERNAL_API_SECRET` read path.

---

## 4. Design quality

**G1. Logging convention bypassed. Effort M, risk low.**
338 `console.*` calls outside tests, even though `@wivwav/logger` exists with redaction (`packages/logger/src/logger.ts:49-52`). Concentrated in the API backfill jobs: `jobs/listing-quality-audit.ts` (70), `canonicalize-backfill.ts` (23), `vehicle-identity-backfill.ts` (22), `title-tokenizer-backfill.ts` (21), `image-integrity-backfill.ts` (19). CLI entry points may legitimately print. The risk is losing redaction and structure in the logs that the observability stack ingests. Fix: replace in `apps/api/src/jobs` and `packages/scraper-sources` with the injected logger; keep CLI output as is.

**G2. Large files violating "small files; one responsibility". Effort L, risk medium.**
33 production files exceed 400 lines and 61 exceed 300. Worst offenders and their mixed responsibilities:
- `apps/api/src/repositories/listing-repository.ts` (1100 lines, 59 methods): queries, mapping, facets and writes in one class. Split by read model (search, detail, facets, admin).
- `apps/api/src/jobs/listing-quality-audit.ts` (854): query building, scoring and reporting.
- `apps/api/src/jobs/search-reconciliation.ts` (675).
- `apps/api/src/routes/listings.ts` (647) and `internal-scraper.ts` (567).
- `apps/api/src/app.ts` (607, 27 registrations) and `index.ts` (349): composition root also holds scheduling (`index.ts:62` interval) and policy wiring.
- Ops clients: `AIClient.tsx` (760), `QueuesClient.tsx` (662), `ConfigClient.tsx` (631), `OpsOverviewClient.tsx` (547): data fetching, polling, state and presentation in one component.
- Scraper sources: `superior-van.ts` (551), `mobilityworks.ts` (511), `ams-vans-classifieds.ts` (511), `freedom-motors.ts` (496), `ebay-motors.ts` (490), with navigation, parsing and mapping each in one file (the cleaner example is `mobility-van-sales-fetch.ts` plus `-parser.ts`).
- `packages/types/src/listing-validator.ts` (562) and `canonicalize.ts` (522): a types package that contains business logic (see G3).
Fix: do not refactor for its own sake; split when a file is next touched, starting with `listing-repository.ts` which is touched most. Tracked as a standing rule rather than a single PR.

**G3. `packages/types` has become a logic package. Effort M, risk medium.**
`canonicalize.ts`, `listing-validator.ts`, `listing-readiness.ts`, `vin.ts`, `shopping-filters.ts` contain behaviour and thresholds (for example `listing-validator.ts:73-80,471,481`), not only interfaces as `.claude/core.md` describes. Most consumers import it for both; moving it is large. Cheaper: rename or document, and decide whether new helpers (D3, D4, D5) go here or in a new `packages/util`. Recommend a small new package so `types` stays types-only; this needs `wav-new-package` and every Dockerfile (D7 makes that cheaper).

**G4. Worker deliberately duplicates queue names to avoid a dependency. Effort S, risk medium.**
See M5. The comment at `apps/worker/src/index.ts:48-52` is a workaround for `packages/queue` mixing names with BullMQ code. Splitting names and policies (`queues.ts`, pure data) from the adapters (`bullmq/`) is the root cause fix.

**G5. `apps/web` depends on `@wivwav/search` for one helper. Effort S, risk low. Report to web owner.**
`apps/web/src/components/listing/conversionBrand.ts:2` imports `conversionBrandSlug` from the Meilisearch package into a browser-facing app. Confirm the import is tree-shaken so the Meilisearch client never ships to the browser, then move the slug function into `packages/types`. Not edited here because of the #1231 redesign.

**G6. Non-null assertions and `any`. Effort M, risk low.**
About 38 `!` assertions and 5 `any` usages outside tests, against the `.claude/core.md` rule "no unjustified non-null assertions; no `any`". Examples in the D1 helpers (`parseInt(m[1]!, 10)` repeated in 4 files). Some are justified by a regex match; a shared helper (D1) removes most of them. Run `typescript-eslint` `no-non-null-assertion` and `no-explicit-any` as errors with an allowlist and fix by directory.

**G7. Route-level exceptions and dual policy tables. Effort M, risk medium.**
Identity policy (who can call `/internal/ops/*`, `/diagnostics/*`, `/internal/workers`, `/internal/config`, product routes) is encoded in separate plugins registered in a 607-line `app.ts`. `AGENTS.md` forbids new `/admin/*` URLs; none exist as literal paths (`rg "'/admin/"` is empty), but file names still say `admin-*` (`admin-auth.ts`, `admin-config.ts`, `admin-logs.ts`, `admin-ai.ts`, `admin-attention.ts`). Rename in the same pass as D2 so a reader is not misled about which surface is private.

**G8. Composition root does scheduling. Effort M, risk medium.**
`apps/api/src/index.ts` owns the job-run reaper (`:62`), the schedule setup, worker gateway startup and shutdown. `core.md` says the API runs scraping schedules, job processing and Ollama remapping in-process. This is workable for a single instance but makes `index.ts` the place every concern lands. Extract `startBackgroundJobs(app, deps)` and `shutdown(deps)` into `apps/api/src/lifecycle/`. Defer until a second instance or a worker split is planned.

**G9. Dev environment not isolated from production wiring. Effort S, risk low.**
`docker-compose.yml` embeds the dev defaults (S1) and the production compose requires every secret with `:?`. Good, but `scripts/release-manifest.sh` and the `Makefile` describe `WORKER_TOKEN`, a name that no longer matches the API's `WORKER_API_SECRET` (S6). A one-page `docs/ops/environment-variables.md` table (service, variable, required, secret, where set) would give operators one place to look and make `scripts/check-docs.sh` able to verify it against `apps/*/.env.example`.

---

## Proposed follow-up issues (each could be one PR)

| # | Issue | Covers | Effort | Depends on |
|---|---|---|---|---|
| 1 | Single dev environment file with distinct fake values per identity | S1, S6 (names), S8 | S | #1225 merged |
| 2 | Fail closed for all API credentials outside tests | S2, S3 | S | 1 |
| 3 | Bind dev-compose published ports to 127.0.0.1 | S4 | S | none |
| 4 | Shared bearer-auth hook with constant-time compare; rename `admin-*` files | D2, G7 | M | 2 |
| 5 | Route env reads through validated config; remove `PUBLISH_GATE_STRICT` duplicate | S5, D6 | M | none |
| 6 | Shared Ollama URL, user agent, NHTSA endpoint constants | M1, M2, M3 | S | none |
| 7 | Scraper parse helpers extracted and tested; shared source timeout defaults | D1, M7 | S | none |
| 8 | Shared `fetchWithTimeout`, retry and `isRecord` utilities | D3, D4, D5, M6 | M | decision on G3 |
| 9 | Move queue name map into `packages/types`; worker imports it | M5, G4 | S | none |
| 10 | Replace `console.*` with the injected logger in API jobs and scraper-sources | G1 | M | none |
| 11 | Ops UI timing constants and Grafana link setting | M8 | S | none |
| 12 | `turbo prune` Dockerfiles; CI composite setup action | D7, D8 | M | trial image builds |
| 13 | Document environment variables; stale-comment cleanup | G9, S6 | S | 1 |
| 14 | Config key id and re-encrypt script (only if more secrets move into the table) | S7 | M | decision |
| 15 | Split `listing-repository.ts` | G2 | L | none |
| 16 | Ownership decisions: where shared helpers live | G3 | M | decision |

Items 1 to 3, 6, 7 and 9 are independent quick wins and can run in parallel on separate branches. Items 1 and 2 overlap the #1225 branch and should wait for it, or be handed to that session.

## Not checked

- The `claude/secure-ai-ops-mvp-0ac0fd` branch, so S1 to S3 and S6 may be partly fixed there.
- Any running containers, real `.env` files, or the Mac Mini deployment.
- `apps/web` beyond a grep for secrets and imports.
- Dependency licences and `pnpm audit`; run `security-review` and `pnpm audit` separately if a dependency scan is wanted.
- Test files, fixtures and generated code.

---

## 5. Second pass: audit and tech-debt skills

Scope of the pass: auth plugins, the config encryption service, `safeFetch`, the Stripe webhook check, the worker dispatcher, and test coverage by sibling file. Not read in depth: `listing-repository.ts` queries, scraper source logic, the web app. Assumed load: one operator, a few workers, a public read API behind rate limiting.

**Checked and found fine.** `safeFetch` (`apps/api/src/util/safe-fetch.ts`) blocks private ranges, re-checks every redirect hop, and documents its DNS-rebinding gap as a deliberate shortcut, so it is a decision, not a finding. The Stripe check uses `timingSafeEqual` and a replay window (`services/stripe-webhook.ts`). Raw SQL is limited to one test helper (`test-support/integration-db.ts:32`), so no injection surface in production code. Rate limiting is registered ahead of API-key auth (`app.ts:175-216`).

**N1. Secret hint leaks the last 4 characters in plain text (`apps/api/src/services/config-service.ts:57,203`). Effort S, risk low. QW.**
Every encrypted entry also stores `value.slice(-4)` in the unencrypted `hint` column. For a short or low-entropy secret that is a large part of the secret, and it sits in every database backup. Fix: show a fixed mask plus the key name and creation date, or store a short keyed hash instead; keep the UI behaviour that says "a value is set".

**N2. Auth fail-open logic has no direct test (`apps/api/src/plugins/ops-auth.ts`). Effort S, risk low.**
There is no `ops-auth.test.ts`; behaviour is only exercised through route tests that inject a secret. The no-secret, production and non-production branches that S2 is about are untested. Add a small table test (secret set or not, `NODE_ENV` values, right and wrong header) before changing S2, so the fix is checked.

**N3. Test debt by sibling file. Effort M, risk low.**
19 of 96 non-test source files in `apps/api/src/routes` (5 of 39), `jobs` (7 of 30), `services` (5 of 15) and `apps/worker/src/handlers` (2 of 12) have no sibling `.test.ts`. A file without a sibling test can still be covered elsewhere, so this is a starting list, not a verdict. Do it as part of whichever PR next touches each file; list them with the one-line script in this section's method.

**N4. Dependency debt not measured. Effort S, risk low.**
`pnpm outdated -r` returned nothing in this environment (no network or timed out), so there is no dependency view in this report. Run `pnpm outdated -r` and `pnpm audit --prod` locally; Dependabot is configured (`.github/dependabot.yml`) and may already cover this.

### Priority scores (tech-debt framework)

Score = (Impact + Risk) x (6 - Effort), each 1 to 5. Higher first.

| ID | Impact | Risk | Effort | Score |
|---|---|---|---|---|
| S2 fail-open auth | 3 | 5 | 1 | 48 |
| S1 shared dev secret | 4 | 4 | 1 | 40 |
| S4 open dev ports | 2 | 4 | 1 | 30 |
| S3 constant-time compare | 2 | 3 | 1 | 25 |
| D1 scraper helper copies | 3 | 2 | 1 | 25 |
| M1/M2 shared constants | 3 | 2 | 1 | 25 |
| D2 one bearer hook | 4 | 3 | 3 | 21 |
| S5 env reads via config | 3 | 3 | 3 | 18 |
| G1 console to logger | 3 | 2 | 3 | 15 |
| D7 turbo prune Dockerfiles | 3 | 2 | 3 | 15 |
| G2 split large files | 4 | 2 | 5 | 6 |

### Phased plan alongside feature work

1. **Now (one sprint, small PRs):** N2 test, then S2, S3, S1, S4, N1. Items 1 to 3 in the follow-up table. These need no design decisions.
2. **Next:** D1, M1, M2, M5, D5 (shared constants and helpers), then D2 with the bearer hook. Decide G3 first so helpers have a home.
3. **Later, with feature work:** S5 per app, G1 per directory, D7 and D8, N3 as files are touched, G2 when each large file is next edited. S7 only when a second encrypted secret is planned.

**Verdict:** healthy enough to ship; fix first the fail-open auth path (S2) and the shared dev secret (S1), both small.
**Lean:** about -150 lines possible from D1, D3, D5, D6 (copies removed), no dependencies to drop found.
**Not checked:** dependency freshness (N4), `listing-repository.ts` query behaviour, scraper source logic, `apps/web`, running containers, the #1225 branch.
