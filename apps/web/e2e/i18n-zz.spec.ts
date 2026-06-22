import { test, expect } from '@playwright/test'

// Pages to check. Each should switch to the ZZ pseudo-locale via next-intl and
// render UI copy from messages instead of falling back to English.
const PAGES = [
  { name: 'home', path: '/en' },
  { name: 'filters', path: '/en/filters' },
  { name: 'discover', path: '/en/discover' },
]

const ENGLISH_UI_PHRASES = [
  'Find the right accessible vehicle',
  'Describe what you need',
  'Search results',
  'vehicles found',
  'Show more',
  'Show fewer',
  'Price range',
  'Year range',
  'Maximum mileage',
  'without price listed',
  'without mileage listed',
  'Informational use only',
]

for (const { name, path } of PAGES) {
  test(`${name}: switching to ZZ renders pseudo-localized UI`, async ({ page }) => {
    await page.goto(path)

    // Wait specifically for the language switcher to be present before
    // interacting. This is more reliable than waitForLoadState('networkidle')
    // on API-heavy pages (filters, discover) where background fetches can
    // keep the network busy indefinitely.
    await page.locator('#language-switcher').waitFor({ state: 'visible' })

    // Switch to ZZ using the language switcher dropdown.
    await page.selectOption('#language-switcher', 'zz')

    // Hard navigation (window.location.href) means we wait for a full page load.
    await page.waitForURL(/\/zz(\/|$)/)
    expect(page.url(), `${name} should not double-prefix the locale`).not.toContain('/zz/zz')
    await page.locator('#language-switcher').waitFor({ state: 'visible' })
    await expect(page.locator('#language-switcher')).toHaveValue('zz')

    // Collect all visible text the user can read. innerText respects CSS
    // visibility so hidden/sr-only nodes are excluded.
    const visibleText = await page.locator('body').innerText()

    expect(visibleText, `${name} should include pseudo-localized text`).toContain('****')
    for (const phrase of ENGLISH_UI_PHRASES) {
      expect(visibleText, `Found English UI phrase on ${name}: ${phrase}`).not.toContain(phrase)
    }
  })
}
