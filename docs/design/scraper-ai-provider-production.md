# Scraper AI Provider — Production Decision Record

_Reviewed: 2026-06-18 · Refs issue #143_

## Audit: When Is Ollama Called?

**Answer: only on DOM fingerprint change, not on every scrape.**

Relevant call chain (all paths in `apps/scraper/src/`):

| File | Key location | Behaviour |
|------|-------------|-----------|
| `engine/scraper-engine.ts` | `runSource()` lines 49–67 | Optional page-1 hash check — if page 1 is unchanged the function returns early and Ollama is never reached. |
| `engine/scraper-engine.ts` | `runSource()` lines 69–118 | Calls `adapter.checkStructure()` unconditionally (reads the stored fingerprint hash and computes the current one). Proceeds to `detector.remapFields()` **only if** `structureCheck.changed === true`. |
| `ai/structure-detector.ts` | `remapFields()` | Calls `provider.complete()` once per invocation — one LLM call per changed source, not per listing. |
| `index.ts` | `SOURCE_SCRAPE` worker (lines 126–138) | Builds an `OllamaProvider`, calls `isAvailable()`, and passes `null` if Ollama is unreachable. The engine handles `null` gracefully by marking the source `needs_remapping` and skipping the scrape rather than throwing. |

Because the fingerprint hash is stored and compared on each scheduled scrape run, a typical production day produces **zero Ollama calls per source** unless the site's DOM structure changes.

## Model Version Pinning Strategy

The expected model name resolves through three layers (first non-null value wins):

1. **DB config key** `ai.scraper.structure.model` — can be updated via `/ops/ai` without a deployment.
2. **Environment variable** `OLLAMA_MODEL` — set at container start via `docker-compose.yml` or a deployment env block.
3. **Hard-coded default** `llama3.2:3b` in `apps/scraper/src/ai/ollama-provider.ts` constructor (and matching fallback in `buildOllamaProvider()` in `index.ts`).

The Ollama image version is pinned to `ollama/ollama:0.30.6` in `docker-compose.yml`.

**This PR pins the model tag to `llama3.2:3b`** in `docker-compose.yml`, `apps/scraper/.env.example`, `apps/scraper/src/ai/ollama-provider.ts`, and the `buildOllamaProvider()` function in `apps/scraper/src/index.ts`. Before this change the untagged value `llama3.2` allowed Ollama to resolve the tag at `ollama pull` time, which could yield different quantisation variants across pull dates and produce inconsistent extraction results.

## Docker / Deployment: Ollama Is Not Shipped by Default

The `ollama` service in `docker-compose.yml` is gated behind the `ai` profile:

```yaml
ollama:
  image: ollama/ollama:0.30.6
  profiles: [ai]          # only starts with: docker compose --profile ai up
```

**The default `docker compose up` stack does not include Ollama.** No GPU or large-model RAM is required for a baseline production deployment.

The scraper handles Ollama absence gracefully at the `SOURCE_SCRAPE` worker level:

```typescript
// apps/scraper/src/index.ts — SOURCE_SCRAPE worker
const aiAvailable = await ollamaProvider.isAvailable()
if (!aiAvailable) {
  context?.logger?.warn('Ollama unavailable — running without AI-assisted remapping')
  await context?.log('Ollama unavailable — running without AI-assisted remapping')
}
await runSourceWithProvider(sourceId, aiAvailable ? ollamaProvider : null, context)
```

When `null` is passed, `scraper-engine.ts` marks the source `needs_remapping` and skips the scrape until a human resolves the mapping. This is the correct safety-first behaviour.

**Resource requirements if Ollama is added to production:**

| Model variant | Minimum RAM | GPU | Notes |
|--------------|-------------|-----|-------|
| `llama3.2:1b` | ~2 GB | Optional | Sufficient for CSS selector extraction tasks |
| `llama3.2:3b` | ~4 GB | Optional | Resolved default without explicit tag pinning |
| `llama3.2:8b` | ~8 GB | Recommended | Not needed for this selector-remapping use case |

For the selector-remapping task (structured JSON output, ~8 KB context), `llama3.2:1b` is likely sufficient and the most cost-efficient.

## Production Options Comparison

### Option A — Claude API (Anthropic)

Replace or supplement `OllamaProvider` with an `AnthropicProvider` behind the existing `CompletionProvider` interface. The `packages/agents/src/anthropic-provider.ts` implementation already exists and can be adapted.

| Dimension | Assessment |
|-----------|-----------|
| Cost | ~$1.00 per 1M input tokens (claude-haiku-4-5). At ~8 KB input/call and low call frequency (only on DOM change), estimated cost is < $0.01 per remapping event. Negligible. |
| Reliability | High. Anthropic SLA with global redundancy; no infrastructure to operate. |
| Latency | ~0.5–2 s first token. Acceptable for a non-blocking async job. |
| Operational complexity | Low. API key in env/secrets; no containers, no GPU, no model pulls. |
| Consistency | Deterministic across environments when the model name and version are pinned. |
| Risk | External dependency. DNS/network outage degrades to the same `needs_remapping` fallback already in place. |
| **Verdict** | **Best fit for production.** Minimal cost, no model infrastructure, consistent outputs. |

### Option B — Pre-compute and Persist Mappings

Store CSS selector mappings in the DB and invoke AI only when the DOM fingerprint changes.

| Dimension | Assessment |
|-----------|-----------|
| Cost | Same or lower than today (already conditional on hash change). |
| Reliability | Mappings survive Ollama unavailability. |
| Latency | No latency once mappings are stored. |
| Operational complexity | Medium. Requires seeding initial mappings and a review workflow for AI-proposed remaps. |
| Risk | Mappings drift silently if AI-generated remaps are wrong and the `REMAP_CONFIDENCE_THRESHOLD = 0.7` guard misses the error. |
| **Verdict** | **Already the current behaviour.** `SourceRepository.setMappings()` persists new mappings after every remap and the confidence guard prevents low-quality remaps from being applied. No new implementation required. |

### Option C — Dedicated Ollama Service

Run one shared Ollama container (or a small cluster) reachable by all scraper instances.

| Dimension | Assessment |
|-----------|-----------|
| Cost | Fixed server cost: ~$30–$100/month for a CPU instance with sufficient RAM. Low call frequency means cost is dominated by the always-on server, not by inference. |
| Reliability | Single point of failure unless clustered. Adds an internal network dependency. |
| Latency | Similar to co-located; cold start only on service restart. |
| Operational complexity | Medium-high. Persistent service management, healthchecks, model pulls on deploy, and coordinating model-version upgrades without disrupting in-flight calls. |
| Consistency | Better than per-container installs but still subject to tag-drift unless both the image version and model tag are pinned. |
| Risk | Shared service becomes a bottleneck at high call rates. At current rates (< 10 remaps/day across two sources) the overhead is not justified. |
| **Verdict** | Valid for high-volume scenarios. Overkill at current call frequency. Revisit if sources scale beyond ~20. |

## Recommendation

1. **Short term (before beta):** Keep Ollama opt-in (`--profile ai`) for local development. For production, either point `OLLAMA_BASE_URL` at an existing shared Ollama service or leave it unset — the scraper degrades safely to `needs_remapping` without it.

2. **Medium term (production hardening):** Add an `AnthropicProvider` to `apps/scraper/src/ai/` behind the existing `CompletionProvider` interface, activated via a new DB key (e.g. `ai.scraper.structure.provider`) or an `AI_PROVIDER` env var. Note: the key `ai.scraper.structure.provider` currently exists in `index.ts` but is explicitly deprecated and ignored — the follow-up must wire up a new selection path. This is a small, bounded change that gives a production-grade AI path without any model infrastructure. See follow-up issue #144.

3. **Model pinning fix:** Pin the model tag to `llama3.2:3b` in `docker-compose.yml`, `apps/scraper/.env.example`, and the `OllamaProvider` default to prevent silent quantisation drift. See follow-up issue #145.

## Follow-Up Issues

Two follow-up issues were opened from this audit:

- **#144** — `feat(scraper): add AnthropicProvider for structure detection` — Implement `apps/scraper/src/ai/anthropic-provider.ts` behind `CompletionProvider`, activated by `ai.scraper.structure.provider = anthropic` in the DB config or `AI_PROVIDER=anthropic` in env.

- **#145** — Closed by this PR. The model tag pin (`llama3.2` → `llama3.2:3b`) is applied in `docker-compose.yml`, `apps/scraper/.env.example`, `apps/scraper/src/ai/ollama-provider.ts`, and the `buildOllamaProvider()` function in `apps/scraper/src/index.ts`.
