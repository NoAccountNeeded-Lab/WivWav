import { configDefaults, defineConfig } from 'vitest/config'

// Unit tier: no live infrastructure required. Integration specs (real
// Postgres/Meilisearch/Valkey) live in *.integration.test.ts and run
// separately via `pnpm test:integration` (see vitest.integration.config.ts).
// Scoped to src/ (not dist/) so the built .js copies of *.integration.test.ts
// — which a plain glob exclude wouldn't catch, since it only matches .ts —
// never run twice or slip into the unit tier.
export default defineConfig({
  // Don't let a local .env/.env.local silently leak infra URLs into the unit
  // tier (see vitest.integration.config.ts for why this matters there).
  envDir: false,
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    exclude: [...configDefaults.exclude, 'src/**/*.integration.test.ts'],
  },
})
