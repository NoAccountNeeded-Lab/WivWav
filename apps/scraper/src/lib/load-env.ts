import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

/**
 * Load the scraper app's environment for standalone scripts.
 *
 * Resolve from this module rather than process.cwd() so documented root-level
 * `pnpm tsx apps/scraper/src/jobs/...` invocations and calls from other working
 * directories consistently use apps/scraper/.env.
 */
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })
