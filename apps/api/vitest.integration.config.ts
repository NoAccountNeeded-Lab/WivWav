import { defineConfig } from 'vitest/config'

// Integration tier: exercises repositories and services against real
// Postgres, Meilisearch, and Valkey (see .agents/issue-context.md #599 /
// AGENTS.md for the expected DATABASE_URL / MEILISEARCH_* / VALKEY_URL env).
// Assumes the target database is already migrated — CI runs `pnpm db:migrate`
// first; locally run it yourself before `pnpm test:integration`.
export default defineConfig({
  // Vite/Vitest auto-loads .env/.env.local from the package root by default,
  // which would silently override an explicitly-set DATABASE_URL/VALKEY_URL/
  // MEILISEARCH_* with whatever a developer's local dev-stack .env points at
  // (typically the same default ports as this tier expects). These specs
  // TRUNCATE tables and FLUSHDB — disable dotenv auto-loading so they only
  // ever target whatever the caller explicitly put in process.env.
  envDir: false,
  test: {
    include: ['src/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Real network I/O against service containers is slower than mocked unit tests.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration specs share tables/indices; running them serially avoids
    // cross-test truncation races within a single worker.
    fileParallelism: false,
  },
})
