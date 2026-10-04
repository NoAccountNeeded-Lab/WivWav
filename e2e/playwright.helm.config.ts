import { defineConfig, devices } from '@playwright/test'

/**
 * Route-mocked operator journey for /helm (issue #1071).
 *
 * Separate from `playwright.config.ts` on purpose: that config's globalSetup
 * boots the Docker stack (api/web/postgres/...), which this suite does not
 * need. Here the real ops Next.js app runs under `next dev`, the browser
 * carries a validly signed ops session, and every `/api/bff/*` call is
 * answered by `helm/fake-api.ts`. So the page, BFF paths, polling, focus and
 * recovery logic are real; the API data is mocked. A live-stack run is still
 * needed to prove real API/queue behaviour.
 *
 * Run: `pnpm --filter @wivwav/e2e e2e:helm` (starts `next dev` itself). Next
 * allows one `next dev` per app directory, so if one is already running, build
 * and serve ops separately and point at it:
 *   OPS_SESSION_SECRET=s pnpm --filter @wivwav/ops build
 *   OPS_SESSION_SECRET=s pnpm --filter @wivwav/ops exec next start --port 54002
 *   OPS_SESSION_SECRET=s WIVWAV_HELM_E2E_URL=http://127.0.0.1:54002 pnpm --filter @wivwav/e2e e2e:helm
 */
const PORT = 54002
// Point at an already-running ops dev server instead of starting one (Next
// allows a single `next dev` per app directory). The session secret must then
// match that server's: unset OPS_SESSION_SECRET falls back to the dev default.
const EXISTING_URL = process.env['WIVWAV_HELM_E2E_URL']

export default defineConfig({
  testDir: './helm',
  outputDir: './test-results-helm',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: EXISTING_URL ?? `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  ...(EXISTING_URL
    ? {}
    : {
        webServer: {
          command: `pnpm --filter @wivwav/ops exec next dev --port ${PORT}`,
          cwd: '..',
          url: `http://127.0.0.1:${PORT}/login`,
          reuseExistingServer: !process.env['CI'],
          timeout: 180_000,
          env: { OPS_SESSION_SECRET: process.env['OPS_SESSION_SECRET'] ?? 'e2e-helm-session-secret' },
        },
      }),
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
