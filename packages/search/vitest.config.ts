import { configDefaults, defineConfig } from 'vitest/config'

// Unit tier: no live infrastructure required. The syncListings integration
// spec (real Postgres + Meilisearch) lives in *.integration.test.ts and runs
// separately via `pnpm test:integration` (see vitest.integration.config.ts).
// Scoped to src/ (not dist/) so the built .js copy of the integration spec —
// which a plain glob exclude wouldn't catch, since it only matches .ts —
// never runs twice or slips into the unit tier.
export default defineConfig({
  // Don't let a local .env/.env.local silently leak infra URLs into the unit
  // tier (see vitest.integration.config.ts for why this matters there).
  envDir: false,
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    exclude: [...configDefaults.exclude, 'src/**/*.integration.test.ts'],
  },
})
