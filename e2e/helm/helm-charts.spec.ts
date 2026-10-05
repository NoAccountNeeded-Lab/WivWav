import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { installFakeApi, newFakeApi, signIn, type FakeApi } from './fake-api.js'

/**
 * Chart experience on /helm (issue #1071), ROUTE-MOCKED like the journey spec:
 * the real ops app and Recharts render in a real browser; `/api/bff/*` answers
 * come from ./fake-api.ts. Covers the default queue view, the by-stage
 * alternate, collapsed details, scrape history views, missing/stale queue data,
 * keyboard access to the chart and an axe scan.
 */

let api: FakeApi

test.beforeEach(async ({ page, context, baseURL }) => {
  api = newFakeApi()
  await signIn(context, baseURL ?? 'http://127.0.0.1:54002')
  await installFakeApi(page, api)
})

type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>

function violationSummary(results: AxeResults): string[] {
  return results.violations.map(item => `${item.id}: ${item.nodes.map(node => `${node.target.join(' ')} [${node.any.map(check => JSON.stringify(check.data)).join(' ')}]`).join(', ')}`)
}

const queueChart = (page: Page) => page.getByRole('figure', { name: /Work in the queues right now/ })
const historyChart = (page: Page) => page.getByRole('figure', { name: /Recent scrape results/ })

async function openFlow(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/helm?section=flow')
  await expect(page.getByRole('heading', { level: 3, name: 'Work in the queues right now' })).toBeVisible()
}

test('queue chart leads with waiting and running; 18 delayed-only queues stay out of it', async ({ page }) => {
  await openFlow(page)
  const summary = page.getByRole('status').filter({ hasText: 'waiting and' }).first()
  await expect(summary).toContainText('9 waiting and 2 running across 3 of 21 queues')
  await expect(summary).toContainText('19 delayed jobs are held for later (scheduled or retrying; the API does not say which) and not counted as waiting')
  await expect(page.getByText(/No queue history is recorded/)).toBeVisible()
  await expect(page.getByText('Not drawn: 18 queues have only delayed jobs. Every queue is listed in Queue details.')).toBeVisible()

  const chart = queueChart(page).locator('svg.recharts-surface')
  await expect(chart).toBeVisible()
  const box = await chart.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThan(200)
  expect(box?.height ?? 0).toBeGreaterThan(80)
  // Exact figures are written beside each bar, ranked by waiting + running.
  const labels = chart.locator('text')
  await expect(labels.filter({ hasText: 'Detail crawl' }).first()).toBeVisible()
  await expect(labels.filter({ hasText: '7 waiting · 1 running' })).toBeVisible()
  await expect(labels.filter({ hasText: '0 waiting · 1 running' })).toBeVisible()
  await expect(labels.filter({ hasText: '2 waiting · 0 running' })).toBeVisible()
  await expect(labels.filter({ hasText: 'reference-sync' })).toHaveCount(0)

  // The long table is not under the chart by default.
  const details = page.locator('details', { has: page.getByText(/Queue details \(21 queues\)/) })
  await expect(details).not.toHaveAttribute('open', '')
  await expect(page.getByRole('table', { name: /Current jobs per queue/ })).toBeHidden()
  await page.getByText(/Queue details \(21 queues\)/).click()
  const table = page.getByRole('table', { name: /Current jobs per queue/ })
  await expect(table.getByRole('row')).toHaveCount(1 + 21 + 1)
  await expect(table.getByRole('row', { name: /Detail crawl detail-crawl.*7 1 1 0/ })).toBeVisible()
})

test('the by-stage view reconciles with the queue view and survives a refresh', async ({ page }) => {
  await openFlow(page)
  await page.getByRole('button', { name: 'By stage' }).click()
  await expect(page.getByText('Which part of the pipeline has work waiting?')).toBeVisible()
  const chart = queueChart(page).locator('svg.recharts-surface')
  await expect(chart.locator('text', { hasText: 'Detail crawl and' })).toBeVisible()
  // detail-extract is not reported by the fake API, so the stage says so instead of reading as complete.
  await expect(chart.locator('text', { hasText: 'at least 7 waiting' })).toBeVisible()
  await expect(chart.locator('text', { hasText: '1 queue not reported' })).toBeVisible()
  await expect(chart.locator('text', { hasText: 'Other queues' })).toBeVisible()

  const before = api.calls.filter(call => call.path === '/admin/queues').length
  await page.getByRole('button', { name: /refresh/i }).first().click()
  await expect.poll(() => api.calls.filter(call => call.path === '/admin/queues').length).toBeGreaterThan(before)
  await expect(page.getByRole('button', { name: 'By stage' })).toHaveAttribute('aria-pressed', 'true')
  await expect(chart.locator('text', { hasText: 'Detail crawl and' })).toBeVisible()
})

test('the chart is keyboard reachable and shows a tooltip with the exact numbers', async ({ page }) => {
  await openFlow(page)
  const chart = queueChart(page).locator('svg.recharts-surface')
  await chart.focus()
  await expect(chart).toBeFocused()
  await page.keyboard.press('ArrowRight')
  const tooltip = queueChart(page).locator('.recharts-tooltip-wrapper')
  await expect(tooltip).toContainText(/Waiting \(queued, not started\): \d+ jobs/)
  await expect(tooltip).toContainText(/Running \(a worker has it\): \d+ jobs/)
})

test('missing queue data is unknown, not zero, and a failed refresh keeps the last reading marked stale', async ({ page }) => {
  await openFlow(page)
  await expect(page.getByRole('status').filter({ hasText: 'waiting and' }).first()).toContainText('9 waiting')
  api.queueData = 'unavailable'
  await page.getByRole('button', { name: /refresh/i }).first().click()
  await expect(page.getByText(/last successful reading; the latest refresh failed/)).toBeVisible()
  await expect(page.getByText('Nothing is waiting or running')).toHaveCount(0)

  // A fresh page with no successful reading at all says unknown.
  await page.reload()
  await expect(page.getByText(/what is waiting is unknown \(not zero\)/)).toBeVisible()
})

test('scrape history: outcomes by source by default, a per-source listings view on request', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/helm?section=activity')
  await expect(page.getByRole('heading', { level: 3, name: 'Recent scrape results' })).toBeVisible()
  await expect(page.getByText(/The 3 most recent scrape runs across all sources/).first()).toBeVisible()
  await expect(page.getByText('Which sources keep failing?')).toBeVisible()
  const chart = historyChart(page).locator('svg.recharts-surface')
  // Figures wrap onto whole-figure lines beside the bar; each line is its own text node.
  await expect(chart.locator('text', { hasText: '1 failed · 0 succeeded' })).toBeVisible()
  await expect(chart.locator('text', { hasText: 'latest failed' })).toBeVisible()
  await expect(chart.locator('text', { hasText: '0 failed · 2 succeeded' })).toBeVisible()
  await expect(chart.locator('text', { hasText: 'latest succeeded' })).toBeVisible()

  await page.getByRole('button', { name: 'Listings found per run' }).click()
  await expect(page.getByText(/not total inventory/)).toBeVisible()
  await page.getByRole('combobox', { name: 'Source' }).selectOption({ label: 'Lakeside' })
  await expect(page.getByText(/Lakeside: 2 runs in this window/)).toBeVisible()
  await page.getByText('Numbers for Lakeside').click()
  await expect(page.getByRole('table', { name: /Runs of Lakeside/ }).getByRole('row')).toHaveCount(3)

  // Details are collapsed until asked for, then an Inspect action opens the investigation.
  await expect(page.getByRole('table', { name: /scrape runs across all sources/ })).toBeHidden()
  await page.getByText(/Run details by source \(2 sources\)/).click()
  await page.getByRole('button', { name: 'Inspect latest run of BLVD' }).click()
  await expect(page.getByRole('complementary')).toBeVisible()
})

test('axe finds no WCAG A/AA violations on the open chart sections, and screenshots are saved', async ({ page }) => {
  await openFlow(page)
  await page.getByText(/Queue details \(21 queues\)/).click()
  await page.screenshot({ path: '/tmp/helm-chart-flow-desktop.png', fullPage: true })
  await page.locator('div', { has: queueChart(page) }).last().screenshot({ path: '/tmp/helm-chart-queues-desktop.png' })
  const flow = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(violationSummary(flow)).toEqual([])

  await page.goto('/helm?section=activity')
  await expect(page.getByRole('heading', { level: 3, name: 'Recent scrape results' })).toBeVisible()
  await page.getByText(/Run details by source/).click()
  await page.screenshot({ path: '/tmp/helm-chart-activity-desktop.png', fullPage: true })
  const activity = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(violationSummary(activity)).toEqual([])

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/helm?section=flow')
  await expect(page.getByRole('heading', { level: 3, name: 'Work in the queues right now' })).toBeVisible()
  // No horizontal page overflow at phone width; wide tables scroll inside their own region.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.screenshot({ path: '/tmp/helm-chart-flow-narrow.png', fullPage: true })
  await queueChart(page).screenshot({ path: '/tmp/helm-chart-queues-narrow.png' })
})

test('no chart label or figure is clipped at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/helm?section=flow')
  await page.getByRole('button', { name: 'By stage' }).click()
  for (const chart of [queueChart(page), historyChart(page)]) {
    const svg = chart.locator('svg.recharts-surface')
    await expect(svg).toBeVisible()
    const frame = await svg.boundingBox()
    const texts = await svg.locator('text').all()
    expect(texts.length).toBeGreaterThan(0)
    for (const text of texts) {
      const box = await text.boundingBox()
      expect(box?.x ?? 0, `${await text.textContent()} starts inside the chart`).toBeGreaterThanOrEqual((frame?.x ?? 0) - 1)
    }
  }
})
