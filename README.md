# WivWav

Wheelchair accessible vehicle (WAV) search aggregator. Scrapes listings from multiple sources, normalizes data, and presents an analytics-first filter dashboard — mobile-first, API-first.

**No sign-up required to search.**

---

## What is WivWav?

Finding a wheelchair accessible vehicle is hard. Listings are scattered across dealer sites, classifieds, and specialty marketplaces — each with different formats and no standard data model.

WivWav scrapes, normalizes, and indexes WAV listings so buyers can filter by what actually matters: ramp type, floor lowering depth, conversion manufacturer, lift presence, hand controls, and more.

---

## Running it

**Prerequisites:** Docker, Node 26, pnpm 11

Pick one of the two paths below — both start api, web, and ops, so don't run both.

### Option A: local dev with hot reload (recommended while developing)

```bash
# One-time setup
pnpm install
pnpm db:generate
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
cp packages/db/.env.example packages/db/.env

# apps/api refuses to start without CONFIG_ENCRYPTION_SECRET. Generate one and
# uncomment it in apps/api/.env with the value below:
openssl rand -hex 32

# Each session
make dev       # starts Postgres, Valkey, Meilisearch in Docker, applies
               # migrations, then runs api, web, and ops locally with hot reload
```

| Service     | URL                   |
| ----------- | --------------------- |
| Web app     | http://localhost:4000 |
| API         | http://localhost:3001 |
| Meilisearch | http://localhost:7700 |

```bash
make down      # stop the Postgres/Valkey/Meilisearch containers started by make dev
```

### Option B: full Docker stack

```bash
# One-time setup
cp apps/api/.env.example apps/api/.env

# Each session
make up        # starts the entire stack in Docker — infra, api, web, ops,
               # Ollama, and observability. Builds images automatically on first run.
```

`CONFIG_ENCRYPTION_SECRET` has a working default baked into `docker-compose.yml`
for this path, so no manual secret setup is needed here (set your own value for
anything beyond local dev).

| Service     | URL                   |
| ----------- | --------------------- |
| Web app     | http://localhost:3000 |
| API         | http://localhost:3001 |
| Meilisearch | http://localhost:7700 |

```bash
make down      # stop all containers
```

### Quality checks (either path)

```bash
make test      # unit tests
make typecheck # type check
make lint      # lint
```

### Optional: local AI for self-healing scraping

apps/api can detect site layout changes and remap CSS selectors using an AI model. Normal `make dev` works fine without it.

**Ollama (local, no API key):**
```bash
docker compose --profile ai up
```
Downloads and caches the model on first run (~2 GB). Use `OLLAMA_MODEL=qwen2.5` to override.

**Anthropic (production):**
Set `ai.scraper.structure.provider` and `ai.scraper.structure.apiKeyId` in the config DB via `/ops/ai`. The API key is stored encrypted — no env var needed.

If neither provider is reachable, scraping continues without AI remapping — layout-changed sources are flagged for manual review.

---

## Where to find things

```
apps/
  api/       Fastify REST API (TypeScript, Node 26) — scraping schedules,
             job processing, and AI-assisted extraction all run here
  web/       Next.js 16 frontend (App Router)
  ops/       Next.js 16 operations UI
  worker/    Remote job-runner fleet (Chromium/DOM jobs)
packages/
  types/     Shared TypeScript interfaces
  db/        Prisma schema + client (PostgreSQL)
  config/    Shared tsconfig and ESLint configs
```

- [AGENTS.md](AGENTS.md) — architecture details and agent workflow

---

## Accessibility

WivWav targets **WCAG 2.1 AA** compliance. This tool serves users who depend on accessible vehicles — the tool itself should be accessible too.

---

## License

MIT
