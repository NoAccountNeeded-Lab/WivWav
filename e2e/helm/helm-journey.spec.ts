import { expect, test, type Page } from '@playwright/test'
import { installFakeApi, newFakeApi, signIn, type FakeApi } from './fake-api.js'

/**
 * Operator journey for /helm (issue #1071), ROUTE-MOCKED: the real ops app and
 * browser run; `/api/bff/*` answers come from ./fake-api.ts. It covers source
 * selection, an enqueue failure, completion WITHOUT recovery, and recovery
 * from fresh evidence — the one complete source-failure journey.
 */

const PROBLEM_TITLE = /Inspect BLVD source is in error/

async function openProblem(page: Page) {
  await page.goto('/helm')
  await expect(page.getByRole('heading', { level: 1, name: 'Helm' })).toBeVisible()
  await page.getByRole('button', { name: PROBLEM_TITLE }).click()
}

let api: FakeApi

test.beforeEach(async ({ page, context, baseURL }) => {
  api = newFakeApi()
  await signIn(context, baseURL ?? 'http://127.0.0.1:54002')
  await installFakeApi(page, api)
})

test('overview shows independent inventory counts and never claims healthy while a problem is open', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/helm')
  const counts = page.getByRole('list', { name: 'Inventory counts' })
  await expect(counts.getByRole('listitem')).toHaveCount(4)
  await expect(counts).toContainText('1,200')
  await expect(page.getByText('Database: available')).toBeVisible()
  await expect(page.getByText('1 critical problem')).toBeVisible()
  await expect(page.getByText('Healthy', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Legacy ops' })).toHaveAttribute('href', '/ops')
})

test('source failure journey: enqueue failure → completed without recovery → recovery from fresh evidence', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openProblem(page)

  // Desktop: nonmodal inspector next to the overview, URL carries the chain.
  const inspector = page.getByRole('complementary')
  await expect(inspector).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/problem=domain%3Asource_error%3Asource%3As1/)
  await expect(inspector.getByRole('heading', { name: 'What happened' })).toBeVisible()

  // Select the source from the breadcrumb path, then act on exactly that source.
  await inspector.getByRole('button', { name: /Source: BLVD/ }).click()
  await expect(inspector.getByRole('list', { name: 'Pipeline stages for this source' })).toBeVisible()
  await expect(inspector.getByRole('button', { name: 'Run source now' })).toBeVisible()

  // 1. Enqueue failure is visible and tracks no job.
  api.runBehaviour = 'reject'
  await inspector.getByRole('button', { name: 'Run source now' }).click()
  const alert = inspector.getByRole('alert').filter({ hasText: 'was not accepted' })
  await expect(alert).toContainText('HTTP 503 SERVICE_UNAVAILABLE')
  await expect(alert).toContainText('No job was queued')

  // 2. Accepted: the returned job id and a queued/running outcome are shown.
  api.runBehaviour = 'accept'
  await inspector.getByRole('button', { name: 'Run source now' }).click()
  const actions = inspector.getByRole('list', { name: 'Actions for this source' })
  await expect(actions).toContainText('job 77')
  expect(api.calls.filter(call => call.method === 'POST' && call.path === '/admin/sources/s1/run')).toHaveLength(2)
  await expect(actions).toContainText(/Running|Queued/)

  // 3. Job completes, but the source is still flagged and the problem still reported: NOT recovered.
  api.jobStatus = 'completed'
  api.jobFinishedAtMs = Date.now()
  api.freshRun = true // a successful run exists...
  // ...but the source row and problem aggregate still say it is broken.
  await expect(actions).toContainText('Completed')
  await expect(actions).toContainText('Not recovered')
  await expect(actions).not.toContainText('Recovery confirmed')

  // 4. Fresh evidence shows the source healthy, the problem cleared, signals available: recovered.
  api.sourceHealthy = true
  api.problemReported = false
  await expect(actions).toContainText('Recovery confirmed')
  await expect(actions).toContainText('not matched to the job by id')

  // Tracking survives closing the inspector and shows under Activity.
  await inspector.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('complementary')).toHaveCount(0)
  const tracked = page.getByRole('list', { name: 'Tracked actions' })
  await expect(tracked).toContainText('Recovery confirmed')
  // The rejected first attempt is listed as "no job", never as a failed job or a failed recovery.
  await expect(tracked).toContainText('The request was not accepted (HTTP 503 SERVICE_UNAVAILABLE)')
  await expect(tracked).toContainText('Request rejected')
  await expect(tracked).toContainText('No job was queued')
  await expect(tracked).not.toContainText(/the job failed/i)
  // Progress was announced through the single polite live region.
  await expect(page.getByTestId('action-announcer')).toContainText('Recovery confirmed')
})

test('a problem that vanishes while a signal is unavailable is not reported as recovery', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  api.runBehaviour = 'accept'
  await page.goto('/helm?source=s1')
  const inspector = page.getByRole('complementary')
  await inspector.getByRole('button', { name: 'Run source now' }).click()
  const actions = inspector.getByRole('list', { name: 'Actions for this source' })
  await expect(actions).toContainText('job 77')
  api.jobStatus = 'completed'
  api.jobFinishedAtMs = Date.now()
  api.freshRun = true
  api.sourceHealthy = true
  api.problemReported = false
  api.dbSignalAvailable = false
  await expect(actions).toContainText('Recovery unconfirmed')
  await expect(actions).toContainText('not proof it is fixed')
  await expect(actions).not.toContainText('Recovery confirmed')
})

test('desktop inspector is resizable from the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openProblem(page)
  const inspector = page.getByRole('complementary')
  const separator = page.getByRole('separator', { name: 'Resize inspector' })
  await expect(separator).toBeVisible()
  const before = (await inspector.boundingBox())?.width ?? 0
  await separator.focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await inspector.boundingBox())?.width ?? 0).toBeGreaterThan(before)
  // The overview is still usable beside it.
  await page.getByRole('button', { name: 'Flow' }).click()
  await expect(page.getByRole('list', { name: /Pipeline stages/ })).toBeVisible()
})

test('narrow viewport: full-screen dialog traps focus, closes with Escape and restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 })
  await page.goto('/helm')
  const opener = page.getByRole('button', { name: PROBLEM_TITLE })
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(page.locator('[inert]')).toHaveCount(1)

  // Tab many times: focus never leaves the dialog.
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
  await expect(page.locator('[inert]')).toHaveCount(0)
})

test('a shared URL reopens the same investigation with technical details collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/helm?source=s1&run=${encodeURIComponent('job:n1')}`)
  const inspector = page.getByRole('complementary')
  await expect(inspector.getByRole('navigation', { name: 'Selection path' })).toContainText('source-scrape')
  const technical = inspector.getByText('Technical details')
  await expect(technical).toBeVisible()
  expect(await technical.evaluate(element => (element.closest('details') as HTMLDetailsElement).open)).toBe(false)
})
