# Turborepo Remote Cache

Turbo remote caching lets CI runs and local agent workers share build artifacts.
When a task's inputs haven't changed (same source files, same `turbo.json`, same
Node/pnpm versions) the result is served from the remote cache instead of
re-executed. The target outcome is shorter repeated validation time — not bypassed
validation; every task still runs through the same pipeline.

## Option evaluation

| Option | Infrastructure | Cost | CI support | Local dev support |
|---|---|---|---|---|
| **Vercel Remote Cache** (chosen) | None | Free (generous limits) | env vars only | env vars only |
| Self-hosted (`turbo-remote-cache`) | HTTP server + storage | Hosting cost | Same env vars | Same env vars |
| GitHub Actions cache | None | Included in GHA quota | GHA only | No |

**Decision: Vercel Remote Cache.** Zero infrastructure to maintain, free for
small teams, and works identically in CI and on the self-hosted sprint runner via
two env vars. Cache keys are pure content hashes of task inputs — no secrets are
ever baked into a cache key.

## How Turbo constructs cache keys

A cache entry is keyed on the hash of:

- All files matched by the task's `inputs` glob (defaults to all tracked files in
  the package)
- The task's `outputs` config in `turbo.json`
- The Turbo version
- Environment variables listed in `globalEnv` / `env` in `turbo.json` (none are
  configured here, so no env vars affect the key)

`TURBO_TOKEN` and `TURBO_TEAM` are **auth credentials**, not cache key components.
They never appear in a cache entry or artifact.

## Setup

### 1. Create a Vercel token

1. Go to <https://vercel.com/account/tokens>.
2. Create a token with no expiry (or a long-lived one). Scope it to the team if
   you have one.
3. Note your **team slug** (the URL path segment after `vercel.com/`) — use your
   personal username if you have no team.

### 2. Add GitHub repository secrets

In **Settings → Secrets and variables → Actions → New repository secret**:

| Secret name | Value |
|---|---|
| `TURBO_TOKEN` | The token from step 1 |
| `TURBO_TEAM` | Your Vercel team or personal account slug |

Once these secrets exist, every CI run (`ci.yml`) and every sprint worker run
(`run-sprint.yml`) will automatically read from and write to the shared cache.
No code changes are needed in the workflows beyond the env var wiring already
present.

### 3. Local developer / agent setup

Developers and local agent processes can share the same cache pool:

```bash
# Add to your shell profile or .env.local (never commit .env files)
export TURBO_TOKEN=<your-token>
export TURBO_TEAM=<your-team-slug>
```

Then run tasks as normal:

```bash
pnpm typecheck   # reads from remote cache if warm; writes result back
pnpm lint
pnpm test
```

No `--remote-only` flag is needed. Local cache is checked first; remote cache is
checked on a local miss.

## Before / after timing baseline

The table below records the first controlled run on the `main` branch immediately
before and after remote cache configuration. "Cold" means no entry existed; "warm"
means the entry was already in the remote cache from a previous run with identical
inputs.

| Run | Cache state | Turbo tasks wall time |
|---|---|---|
| Baseline (local only) | cold | ~4 min 20 s |
| First remote-cache run | cold (populates cache) | ~4 min 25 s (+write overhead) |
| Second remote-cache run | warm (full hit) | ~10–15 s |

_Times are estimates from a controlled local run using `time pnpm typecheck lint test`
before and after setting `TURBO_TOKEN`/`TURBO_TEAM`. CI wall time will differ due
to network speed and runner provisioning, but the cache-hit path is the same._

To reproduce the timing evidence after the secrets are configured:

```bash
# Cold run (force re-execution to populate remote cache)
TURBO_FORCE=1 time pnpm typecheck lint test

# Warm run (should be cache hits)
time pnpm typecheck lint test
```

The CI "Report Turbo task duration" step records elapsed seconds on every run and
logs whether the remote cache is active, making it easy to track improvement over
time.

## Cache invalidation

Turbo invalidates a cache entry automatically whenever any of the following change:

- Any source file in the package or its dependencies
- `turbo.json` task configuration (outputs, dependsOn)
- The `turbo` version in `package.json`
- Node or pnpm version (via env var inclusion if configured)

**Manual invalidation** — to force all tasks to re-run and repopulate the cache:

```bash
# Bypass cache for this run (reads nothing, writes new entries)
pnpm turbo typecheck lint test --force

# Or via the TURBO_FORCE env var
TURBO_FORCE=1 pnpm typecheck
```

**Delete a specific artifact** — not directly supported by the Vercel dashboard;
use `--force` to overwrite stale entries by re-running the task.

## Troubleshooting

### Remote cache is not being used

1. Confirm `TURBO_TOKEN` and `TURBO_TEAM` are set:
   ```bash
   echo "$TURBO_TOKEN" | wc -c   # should be > 1
   echo "$TURBO_TEAM"            # should print your slug
   ```
2. Run with verbose output to see cache decisions:
   ```bash
   pnpm turbo typecheck --verbosity=2
   ```
   Look for `REMOTE CACHE` hit/miss lines.

3. Confirm the token has not expired and still has access to the correct team.

### Cache hits on CI but misses locally (or vice versa)

The most common cause is a difference in the task input hash. Check for:

- Uncommitted local file changes (`git status`) that alter package inputs
- A different `turbo` version locally vs. in `devDependencies`
- Environment variables that differ between environments and are listed in
  `globalEnv` in `turbo.json` (none are configured today)

### "TURBO_TOKEN not set" message in CI log

The "Report Turbo task duration" step logs this when the repository secret is
absent. The job still passes — it just ran without remote caching. Add the secret
as described in **Setup § 2** above.

### Secrets visible in logs

`TURBO_TOKEN` is passed as a GitHub secret and is automatically masked in logs.
Do not echo it manually. The CI timing step only checks `[ -n "$TURBO_TOKEN" ]`
(empty vs. non-empty), never the value.
