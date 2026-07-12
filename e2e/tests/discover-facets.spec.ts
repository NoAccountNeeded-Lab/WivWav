import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { assertNoGatingViolations } from '../support/axe.js'
import {
  FACETS_EXPECTED,
  removeFacetsCatalog,
  seedFacetsCatalog,
} from '../support/facets-catalog.js'

/**
 * Fixture-backed Discover facets browser coverage (#641).
 *
 * Runs against the isolated compose stack global-setup boots (fixture data
 * only, no live sources) with the deterministic catalog from
 * support/facets-catalog.ts seeded on top of the smoke listing. Exhaustive
 * backend count/filter correctness is the pipeline contract's job (#640);
 * this suite covers the final boundary: rendering, interaction, URL state,
 * accessibility, and responsive behavior.
 *
 * Renderer coverage: bars (Make/State/…), donut (Condition/Seller type),
 * swatches (Color), and the three histogram range controls — every renderer
 * the product currently mounts. ChipsRenderer exists in the registry but no
 * production page uses it, so it has no browser surface to cover.
 */

const FACETS_API = '**/v1/listings/facets*'

// ── Locator helpers ────────────────────────────────────────────────────────

function facetGroup(page: Page, name: string): Locator {
  return page.getByRole('group', { name, exact: true })
}

/** Bars and donut-legend buttons expose `<label> <count>` as their
 * accessible name; zero-count ghost bars render an em dash. */
function facetButton(page: Page, group: string, label: string, count: number | '—'): Locator {
  const suffix = typeof count === 'number' ? count.toLocaleString('en-US') : count
  return facetGroup(page, group).getByRole('button', { name: `${label} ${suffix}`, exact: true })
}

function swatchButton(page: Page, label: string, count: number): Locator {
  const plural = count === 1 ? 'listing' : 'listings'
  return facetGroup(page, 'Color').getByRole('button', {
    name: `${label}: ${count.toLocaleString('en-US')} ${plural}`,
    exact: true,
  })
}

function vehiclesFound(page: Page, count: number): Locator {
  const noun = count === 1 ? 'vehicle' : 'vehicles'
  return page.getByText(`${count.toLocaleString('en-US')} ${noun} found`)
}

/** Deterministic readiness signal that the facet fetch cycle has rendered. */
async function waitForFacets(page: Page): Promise<void> {
  await expect(facetButton(page, 'Make', 'Toyota', FACETS_EXPECTED.make.Toyota)).toBeVisible()
}

async function expectHistogramCounts(
  page: Page,
  accessibleName: RegExp,
  expectedCounts: readonly number[],
): Promise<void> {
  const chart = page.getByRole('img', { name: accessibleName })
  await expect(chart).toBeVisible()
  const bars = chart.locator('.recharts-bar-rectangle path')
  await expect(bars).toHaveCount(expectedCounts.length)
  for (const [index, count] of expectedCounts.entries()) {
    await bars.nth(index).hover()
    const noun = count === 1 ? 'listing' : 'listings'
    await expect(page.locator('.recharts-tooltip-wrapper').getByText(`${count} ${noun}`)).toBeVisible()
  }
}

// ── Suite ──────────────────────────────────────────────────────────────────

test.describe('Discover facets against the fixture catalog', () => {
  test.beforeAll(async () => {
    // Seeding waits on the scraper's one-minute incremental indexer tick.
    test.setTimeout(240_000)
    await seedFacetsCatalog()
  })

  test.afterAll(async () => {
    // Restores the single-smoke-listing state smoke.spec.ts asserts.
    test.setTimeout(240_000)
    await removeFacetsCatalog()
  })

  test('renders the expected total and exact counts for every visible facet group', async ({ page }) => {
    await page.goto('/en/results')

    await expect(vehiclesFound(page, FACETS_EXPECTED.total)).toBeVisible()
    await waitForFacets(page)

    const barsAndDonutGroups: Array<[string, Record<string, number>]> = [
      ['Make', FACETS_EXPECTED.make],
      ['Model', FACETS_EXPECTED.model],
      ['Trim', FACETS_EXPECTED.trim],
      ['Condition', FACETS_EXPECTED.condition],
      ['Entry type', FACETS_EXPECTED.entryType],
      ['Conversion brand', FACETS_EXPECTED.conversionBrand],
      ['State', FACETS_EXPECTED.state],
      ['Seller type', FACETS_EXPECTED.sellerType],
      ['Features', FACETS_EXPECTED.features],
    ]
    for (const [group, expected] of barsAndDonutGroups) {
      for (const [label, count] of Object.entries(expected)) {
        await expect(facetButton(page, group, label, count)).toBeVisible()
      }
      // Exactly the derived values — no extras, no bogus null/unknown entries.
      await expect(facetGroup(page, group).getByRole('button')).toHaveCount(
        Object.keys(expected).length,
      )
    }

    for (const [label, count] of Object.entries(FACETS_EXPECTED.color)) {
      await expect(swatchButton(page, label, count)).toBeVisible()
    }
    await expect(facetGroup(page, 'Color').getByRole('button')).toHaveCount(
      Object.keys(FACETS_EXPECTED.color).length,
    )

    // Every rendered histogram bucket exposes its exact count on hover; the
    // bar totals and order are hand-derived from the fixture catalog.
    await expectHistogramCounts(page, /^Price distribution histogram/, [1, 1, 1, 1, 2, 1])
    await expectHistogramCounts(page, /^Year distribution histogram/, [1, 1, 1, 1, 1, 2, 1])
    await expectHistogramCounts(page, /^Mileage distribution histogram/, [1, 1, 1, 1, 2, 1, 1])

    // The null-price row is disclosed instead of silently dropped.
    await expect(page.getByText('+ 1 without price listed')).toBeVisible()
  })

  test('hides unknown and none values per product rules while still counting those rows', async ({ page }) => {
    await page.goto('/en/results')
    await waitForFacets(page)

    // The catalog's unknown-entry/unknown-ramp row is in the total…
    await expect(vehiclesFound(page, FACETS_EXPECTED.total)).toBeVisible()

    // …but never surfaces as a selectable facet value.
    await expect(facetGroup(page, 'Entry type').getByRole('button', { name: /Unknown/ })).toHaveCount(0)
    await expect(facetGroup(page, 'Features').getByRole('button', { name: /Unknown/ })).toHaveCount(0)
    await expect(facetGroup(page, 'Features').getByRole('button', { name: /None/ })).toHaveCount(0)
  })

  test('bars renderer: selecting a make updates the URL, results, and pressed state', async ({ page }) => {
    await page.goto('/en/results')
    await waitForFacets(page)

    const toyota = facetButton(page, 'Make', 'Toyota', 2)
    await expect(toyota).toHaveAttribute('aria-pressed', 'false')
    await toyota.click()

    await expect(page).toHaveURL(/make=Toyota/)
    await expect(toyota).toHaveAttribute('aria-pressed', 'true')
    await expect(vehiclesFound(page, 2)).toBeVisible()
    await expect(page.getByRole('heading', { name: '2024 Toyota Sienna XLE' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '2023 Toyota Sienna LE' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Chrysler Pacifica/ })).toBeHidden()
  })

  test('disjunctive counts: the active group keeps sibling values, other groups zero out', async ({ page }) => {
    await page.goto('/en/results')
    await waitForFacets(page)

    await facetButton(page, 'Make', 'Toyota', 2).click()
    await expect(vehiclesFound(page, 2)).toBeVisible()

    // Make (the active group) is computed without its own filter, so every
    // other make stays selectable with its unfiltered count.
    await expect(facetButton(page, 'Make', 'Chrysler', 2)).toBeEnabled()
    await expect(facetButton(page, 'Make', 'Ford', 1)).toBeEnabled()

    // Other groups reflect the Toyota-only result set; vanished values stay
    // visible as disabled zero bars (em dash) rather than lingering counts.
    await expect(facetButton(page, 'Model', 'Sienna', 2)).toBeEnabled()
    await expect(facetButton(page, 'Model', 'Pacifica', '—')).toBeDisabled()
    // Product-rule zero states: entry type, ramp type, and WAV features stay
    // visible as disabled ghosts instead of retaining stale counts.
    await expect(facetButton(page, 'Entry type', 'Rear Entry', '—')).toBeDisabled()
    await expect(facetButton(page, 'Features', 'Fold In', '—')).toBeDisabled()
    await expect(facetButton(page, 'Features', 'Has lift', '—')).toBeDisabled()
    await expect(facetButton(page, 'Features', 'Hand controls', '—')).toBeDisabled()
  })

  test('donut renderer: selecting a condition filters results and keeps disjunctive counts', async ({ page }) => {
    await page.goto('/en/results')
    await waitForFacets(page)

    const newLegend = facetButton(page, 'Condition', 'New', 1)
    await newLegend.click()

    await expect(page).toHaveURL(/condition=new/)
    await expect(newLegend).toHaveAttribute('aria-pressed', 'true')
    await expect(vehiclesFound(page, 1)).toBeVisible()
    await expect(page.getByRole('heading', { name: '2023 Toyota Sienna LE' })).toBeVisible()

    // Disjunctive: the Condition group itself keeps both values selectable.
    await expect(facetButton(page, 'Condition', 'Used', 7)).toBeEnabled()

    // A non-active group narrows to the filtered set, ghosting the rest.
    await expect(facetButton(page, 'Make', 'Toyota', 1)).toBeEnabled()
    await expect(facetButton(page, 'Make', 'Dodge', '—')).toBeDisabled()

    await newLegend.click()
    await expect(page).not.toHaveURL(/condition=/)
    await expect(vehiclesFound(page, FACETS_EXPECTED.total)).toBeVisible()
  })

  test('swatches renderer: selecting a color filters results', async ({ page }) => {
    await page.goto('/en/results')
    await waitForFacets(page)

    const silver = swatchButton(page, 'Silver', 2)
    await silver.click()

    await expect(page).toHaveURL(/color=Silver/)
    await expect(silver).toHaveAttribute('aria-pressed', 'true')
    await expect(vehiclesFound(page, 2)).toBeVisible()
    // Disjunctive within Color: other swatches keep their counts.
    await expect(swatchButton(page, 'Blue', 1)).toBeEnabled()
  })

  test('multi-select and deselect within a group', async ({ page }) => {
    await page.goto('/en/results')
    await waitForFacets(page)

    await facetButton(page, 'Make', 'Toyota', 2).click()
    await expect(vehiclesFound(page, 2)).toBeVisible()

    const chrysler = facetButton(page, 'Make', 'Chrysler', 2)
    await chrysler.click()
    await expect(page).toHaveURL(/make=Toyota%2CChrysler/)
    await expect(vehiclesFound(page, 4)).toBeVisible()
    await expect(chrysler).toHaveAttribute('aria-pressed', 'true')

    await chrysler.click()
    await expect(page).toHaveURL(/make=Toyota(?!%2C)/)
    await expect(vehiclesFound(page, 2)).toBeVisible()
  })

  test('combined filters restore from the query string and verify cross-group counts', async ({ page }) => {
    await page.goto('/en/results?make=Toyota&state=TX')

    await expect(vehiclesFound(page, 1)).toBeVisible()
    await expect(page.getByRole('heading', { name: '2024 Toyota Sienna XLE' })).toBeVisible()

    // Make is disjunctive against state=TX only.
    const toyota = facetButton(page, 'Make', 'Toyota', 1)
    await expect(toyota).toHaveAttribute('aria-pressed', 'true')
    await expect(facetButton(page, 'Make', 'Chrysler', 1)).toHaveAttribute('aria-pressed', 'false')

    // State is disjunctive against make=Toyota only.
    const tx = facetButton(page, 'State', 'TX', 1)
    await expect(tx).toHaveAttribute('aria-pressed', 'true')
    await expect(facetButton(page, 'State', 'CO', 1)).toHaveAttribute('aria-pressed', 'false')

    // A group with no active value sees both filters at once.
    await expect(facetButton(page, 'Condition', 'Used', 1)).toBeVisible()

    // Active filters render as removable pills.
    const pills = page.getByRole('list', { name: 'Active filters' })
    await expect(pills.getByText('Toyota', { exact: true })).toBeVisible()
    await expect(pills.getByText('TX', { exact: true })).toBeVisible()
  })

  test('removing one pill and clearing all filters both restore results', async ({ page }) => {
    await page.goto('/en/results?make=Toyota&state=TX')
    await expect(vehiclesFound(page, 1)).toBeVisible()

    await page.getByRole('button', { name: 'Remove state filter' }).click()
    await expect(page).not.toHaveURL(/state=/)
    await expect(vehiclesFound(page, 2)).toBeVisible()

    await facetButton(page, 'State', 'TX', 1).click()
    await expect(vehiclesFound(page, 1)).toBeVisible()

    await page.getByRole('button', { name: 'Clear all filters' }).click()
    await expect(page).toHaveURL(/\/en\/results$/)
    await expect(vehiclesFound(page, FACETS_EXPECTED.total)).toBeVisible()
  })

  test('back and forward navigation restore filter state and results', async ({ page }) => {
    await page.goto('/en/results')
    await waitForFacets(page)

    await facetButton(page, 'Make', 'Toyota', 2).click()
    await expect(vehiclesFound(page, 2)).toBeVisible()

    await facetButton(page, 'State', 'TX', 1).click()
    await expect(page).toHaveURL(/make=Toyota.*state=TX/)
    await expect(vehiclesFound(page, 1)).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(/make=Toyota(?!.*state=)/)
    await expect(vehiclesFound(page, 2)).toBeVisible()
    await expect(facetButton(page, 'Make', 'Toyota', 2)).toHaveAttribute('aria-pressed', 'true')

    await page.goBack()
    await expect(page).not.toHaveURL(/make=/)
    await expect(vehiclesFound(page, FACETS_EXPECTED.total)).toBeVisible()
    await expect(facetButton(page, 'Make', 'Toyota', 2)).toHaveAttribute('aria-pressed', 'false')

    await page.goForward()
    await expect(page).toHaveURL(/make=Toyota/)
    await expect(vehiclesFound(page, 2)).toBeVisible()
  })

  test('price range control: keyboard commit updates the URL, results, and pill', async ({ page }) => {
    await page.goto('/en/results')
    await waitForFacets(page)

    const maxThumb = page.getByRole('slider', { name: 'Price range maximum' })
    // Readiness: the slider has adopted the fixture catalog's bucket range.
    await expect(maxThumb).toHaveAttribute('aria-valuemax', '65000')

    await maxThumb.press('ArrowLeft')

    await expect(page).toHaveURL(/priceMax=6000000/)
    // Excludes the $62,000 listing and the null-price listing.
    await expect(vehiclesFound(page, 6)).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'Active filters' }).getByText('Up to $60k'),
    ).toBeVisible()
  })

  test('year range control: keyboard commit updates the URL and results', async ({ page }) => {
    await page.goto('/en/results')
    await waitForFacets(page)

    const minThumb = page.getByRole('slider', { name: 'Year range minimum' })
    await expect(minThumb).toHaveAttribute('aria-valuenow', '2018')

    await minThumb.press('ArrowRight')

    await expect(page).toHaveURL(/yearMin=2019/)
    // Excludes the 2018 Grand Caravan.
    await expect(vehiclesFound(page, 7)).toBeVisible()
  })

  test('mileage range control: keyboard commit updates the URL and results', async ({ page }) => {
    await page.goto('/en/results')
    await waitForFacets(page)

    const thumb = page.getByRole('slider', { name: 'Maximum mileage' })
    await expect(thumb).toHaveAttribute('aria-valuenow', '96000')

    await thumb.press('ArrowLeft')

    await expect(page).toHaveURL(/mileageMax=84000/)
    // Excludes the 95,000-mile Grand Caravan (84000-96000 bucket).
    await expect(vehiclesFound(page, 7)).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'Active filters' }).getByText('Under 84,000 mi'),
    ).toBeVisible()
  })

  test('keyboard-only operation: facet buttons are focusable, visibly focused, and activatable', async ({ page }) => {
    await page.goto('/en/results')
    await waitForFacets(page)

    const toyota = facetButton(page, 'Make', 'Toyota', 2)
    await toyota.focus()
    await expect(toyota).toBeFocused()

    // Tab advances to another control inside the group (order among equal
    // counts is data-dependent, so only the containment is asserted).
    await page.keyboard.press('Tab')
    const nextFocused = facetGroup(page, 'Make').locator('button:focus')
    await expect(nextFocused).toBeVisible()
    const indicator = await nextFocused.evaluate((el) => {
      const style = window.getComputedStyle(el)
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
      }
    })
    expect(
      (indicator.outlineStyle !== 'none' && indicator.outlineWidth !== '0px') ||
        indicator.boxShadow !== 'none',
      `focused facet button has no visible focus indicator: ${JSON.stringify(indicator)}`,
    ).toBe(true)

    await page.keyboard.press('Shift+Tab')
    await expect(toyota).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/make=Toyota/)
    await expect(toyota).toHaveAttribute('aria-pressed', 'true')
    await expect(vehiclesFound(page, 2)).toBeVisible()
  })

  test('loading: facet counts appear only once the facets response arrives', async ({ page }) => {
    let releaseFacets = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseFacets = resolve
    })
    await page.route(FACETS_API, async (route) => {
      await gate
      await route.continue()
    })

    await page.goto('/en/results')

    // Server-rendered truth is available immediately…
    await expect(vehiclesFound(page, FACETS_EXPECTED.total)).toBeVisible()
    // …while no facet counts are shown at all rather than placeholders that
    // could be mistaken for data.
    await expect(facetGroup(page, 'Make')).toBeHidden()

    releaseFacets()
    await waitForFacets(page)
  })

  test('facets API failure: results stay truthful with no counts, and recovery restores them', async ({ page }) => {
    await page.route(FACETS_API, (route) => route.abort())
    await page.goto('/en/results')

    await expect(vehiclesFound(page, FACETS_EXPECTED.total)).toBeVisible()
    await expect(facetGroup(page, 'Make')).toBeHidden()

    await page.unroute(FACETS_API)
    await page.reload()
    await expect(vehiclesFound(page, FACETS_EXPECTED.total)).toBeVisible()
    await waitForFacets(page)
  })

  test('facets refresh failure mid-session: results and pressed state stay authoritative', async ({ page }) => {
    await page.goto('/en/results')
    await waitForFacets(page)

    await page.route(FACETS_API, (route) => route.abort())

    const toyota = facetButton(page, 'Make', 'Toyota', 2)
    await toyota.click()

    // The listing grid and aria-live total come from the server render and
    // reflect the applied filter even though the count refresh failed…
    await expect(page).toHaveURL(/make=Toyota/)
    await expect(vehiclesFound(page, 2)).toBeVisible()
    await expect(page.getByRole('heading', { name: /Chrysler Pacifica/ })).toBeHidden()
    // …and selection state is URL-derived, not fetch-derived.
    await expect(toyota).toHaveAttribute('aria-pressed', 'true')

    // Recovery: once the API is reachable again the next interaction
    // reconciles the chart with fresh counts.
    await page.unroute(FACETS_API)
    await facetButton(page, 'Make', 'Chrysler', 2).click()
    await expect(vehiclesFound(page, 4)).toBeVisible()
    await expect(facetButton(page, 'Model', 'Pacifica', 2)).toBeVisible()
  })

  test('empty results state offers recovery without stale counts', async ({ page }) => {
    // No Ford exists in California in the catalog.
    await page.goto('/en/results?make=Ford&state=CA')

    await expect(vehiclesFound(page, 0)).toBeVisible()
    const empty = page.getByRole('status')
    await expect(empty.getByText('No vehicles match your current filters.')).toBeVisible()

    // Counts around the empty state are live, not leftovers: Make is
    // disjunctive against state=CA, where only the Pacifica exists.
    await expect(facetButton(page, 'Make', 'Chrysler', 1)).toBeVisible()

    await empty.getByRole('link', { name: 'Clear all filters' }).click()
    await expect(page).toHaveURL(/\/en\/results$/)
    await expect(vehiclesFound(page, FACETS_EXPECTED.total)).toBeVisible()
  })

  test('filtered facets state passes the WCAG 2.1 AA axe gate', async ({ page }) => {
    await page.goto('/en/results?make=Toyota&state=TX')
    await expect(vehiclesFound(page, 1)).toBeVisible()
    await expect(facetButton(page, 'Make', 'Toyota', 1)).toBeVisible()

    await assertNoGatingViolations(page, '/en/results (facets filtered)')
  })

  test.describe('mobile viewport (375px)', () => {
    test.use({ viewport: { width: 375, height: 812 } })

    test('facets lay out without horizontal overflow and controls stay tappable', async ({ page }) => {
      await page.goto('/en/results')
      await expect(vehiclesFound(page, FACETS_EXPECTED.total)).toBeVisible()
      await waitForFacets(page)

      const horizontalOverflow = await page.evaluate(() => {
        const root = document.documentElement
        return root.scrollWidth - root.clientWidth
      })
      // A zero-tolerance check is brittle to cross-platform Chromium
      // subpixel-rounding noise (macOS local vs. Linux CI runners have
      // produced a spurious 1px delta on unrelated merges — see #739).
      // A few px of slack still catches genuine overflow regressions,
      // which run in the tens of pixels for a widened control.
      const HORIZONTAL_OVERFLOW_TOLERANCE_PX = 2
      expect(
        horizontalOverflow,
        'page must not scroll horizontally at 375px',
      ).toBeLessThanOrEqual(HORIZONTAL_OVERFLOW_TOLERANCE_PX)

      // Repository accessibility contract: at least 44×44 CSS px across one
      // control of each renderer type.
      const targets: Array<[string, Locator]> = [
        ['bars', facetButton(page, 'Make', 'Toyota', 2)],
        ['donut legend', facetButton(page, 'Condition', 'Used', 7)],
        ['swatch', swatchButton(page, 'Silver', 2)],
      ]
      for (const [kind, locator] of targets) {
        const box = await locator.boundingBox()
        if (!box) throw new Error(`${kind} control is not visible, so it has no tap target`)
        expect(box.width, `${kind} control width`).toBeGreaterThanOrEqual(44)
        expect(box.height, `${kind} control height`).toBeGreaterThanOrEqual(44)
      }

      // Interaction still works at mobile width.
      await facetButton(page, 'Make', 'Toyota', 2).click()
      await expect(page).toHaveURL(/make=Toyota/)
      await expect(vehiclesFound(page, 2)).toBeVisible()
    })
  })
})
