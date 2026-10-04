import { composeDown } from './compose.js'
import { cleanupReusedStackFixture } from './fixture-cleanup.js'

export default async function globalTeardown(): Promise<void> {
  if (process.env['WIVWAV_E2E_KEEP_STACK'] === '1') return

  if (process.env['WIVWAV_E2E_SKIP_COMPOSE'] === '1') {
    await cleanupReusedStackFixture()
    return
  }

  composeDown()
}
