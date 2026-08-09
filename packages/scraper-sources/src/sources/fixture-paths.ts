import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Absolute path to the checked-in offline HTML fixtures (#639), resolved
 * relative to this module so consumers never hard-code directory hops.
 *
 * Source-only: the fixtures live under src/ and tsc does not copy .html into
 * dist, so this constant is for test-time use through the source-alias
 * vitest setup (see packages/config/vitest.js), not from built output.
 */
export const FIXTURE_CONTRACTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'contracts',
)
