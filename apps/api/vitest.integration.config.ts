import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { wivwavSourceAliases } from '@wivwav/config/vitest'

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..')

// Integration tier: exercises repositories and services against real
// Postgres, Meilisearch, and Valkey (see .agents/issue-context.md #599 /
// AGENTS.md for the expected DATABASE_URL / MEILISEARCH_* / VALKEY_URL env).
// Assumes the target database is already migrated — CI runs `pnpm db:migrate`
// first; locally run it yourself before `pnpm test:integration`.
export default defineConfig({
  resolve: {
    // fixture-to-facets.integration.test.ts (relocated from apps/scraper by
    // #970) imports @wivwav/scraper-sources's checked-in HTML fixtures via
    // FIXTURE_CONTRACTS_DIR, which is source-only (tsc does not copy .html
    // into dist — see fixture-paths.ts). Subpath entries must precede the
    // bare package alias below: Vite substitutes by prefix, so a bare entry
    // would otherwise mangle subpath imports.
    alias: wivwavSourceAliases(WORKSPACE_ROOT, ['scraper-sources'], [
      {
        find: /^@wivwav\/scraper-sources\/(.*)\.js$/,
        replacement: path.resolve(WORKSPACE_ROOT, 'packages', 'scraper-sources', 'src') + '/$1.ts',
      },
    ]),
  },
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
