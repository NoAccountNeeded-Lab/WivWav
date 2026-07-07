import { composeDown } from './compose.js'

export default function globalTeardown(): void {
  if (process.env['WIVWAV_E2E_SKIP_COMPOSE'] === '1') return
  if (process.env['WIVWAV_E2E_KEEP_STACK'] === '1') return

  composeDown()
}
