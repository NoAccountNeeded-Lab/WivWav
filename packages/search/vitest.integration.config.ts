import { defineConfig } from 'vitest/config'

// Integration tier: exercises syncListings against a real, migrated Postgres
// and a real Meilisearch instance (see AGENTS.md / issue #599 for the
// expected DATABASE_URL / MEILISEARCH_HOST / MEILISEARCH_API_KEY env).
export default defineConfig({
  // Vite/Vitest auto-loads .env/.env.local from the package root by default,
  // which would silently override an explicitly-set DATABASE_URL/MEILISEARCH_*
  // with whatever a developer's local dev-stack .env points at (typically the
  // same default ports as this tier expects). This spec truncates tables and
  // clears the Meilisearch index — disable dotenv auto-loading so it only
  // ever targets whatever the caller explicitly put in process.env.
  envDir: false,
  test: {
    include: ['src/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
