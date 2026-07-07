import { expect, test } from '@playwright/test'
import { apiBaseUrl } from '../support/compose.js'
import { fixtureListingId } from '../support/fixture.js'

test('home renders from the built web container and serves public assets', async ({ page, request }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/en\/?$/)
  await expect(page.getByRole('heading', { name: /find the right accessible vehicle/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /wivwav/i })).toBeVisible()

  const asset = await request.get('/data/us-states-10m.json')
  expect(asset.ok()).toBe(true)
  expect(asset.headers()['content-type']).toContain('application/json')
})

test('Discover can reach searchable results', async ({ page }) => {
  await page.goto('/en/discover')

  await expect(page.getByRole('heading', { name: /find the right accessible vehicle/i })).toBeVisible()
  await page.getByRole('link', { name: /browse on my own/i }).click()

  await expect(page).toHaveURL(/\/en\/results/)
  await expect(page.getByText(/1 vehicle found/i)).toBeVisible()
  await expect(page.getByRole('heading', { name: /2024 Toyota Sienna XLE/i })).toBeVisible()
})

test('listing detail page loads for the seeded listing', async ({ page }) => {
  await page.goto(`/en/vehicle/${fixtureListingId}`)

  await expect(page.getByRole('heading', { name: /2024 Toyota Sienna XLE/i })).toBeVisible()
  await expect(page.locator('header').getByText('$52,990')).toBeVisible()
  await expect(page.getByRole('img', { name: /no photo available/i })).toBeVisible()
})

test('API health is reachable through the built api container', async ({ request }) => {
  const response = await request.get(`${apiBaseUrl()}/health`)
  expect(response.ok()).toBe(true)

  const body = (await response.json()) as {
    status?: string
    services?: Record<string, { status?: string }>
  }

  expect(['ok', 'degraded']).toContain(body.status)
  expect(['up', 'degraded']).toContain(body.services?.postgres?.status)
  expect(['up', 'degraded']).toContain(body.services?.meilisearch?.status)
  expect(['up', 'degraded']).toContain(body.services?.valkey?.status)
})
