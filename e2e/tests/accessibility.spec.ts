import { AxeBuilder } from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { fixtureListingId } from '../support/fixture.js'

type AxeResults = Awaited<ReturnType<InstanceType<typeof AxeBuilder>['analyze']>>
type AxeViolation = AxeResults['violations'][number]
type TriagedAxeViolation = {
  page: string
  ruleId: string
  owner: string
  reason: string
}

// Issue #673 / decision D9 (#666): every user-facing page must meet WCAG 2.1
// AA. This runs axe-core against the same built-container app the smoke
// suite in smoke.spec.ts already boots (see e2e/support/global-setup.ts),
// rather than a parallel harness, and fails CI on serious/critical
// violations. Moderate/minor findings are reported but not gating; triage
// any that appear into the list below with an owner instead of loosening
// the assertion.
const GATING_IMPACTS = new Set(['serious', 'critical'])

// Known, already-triaged violations that are allowed to persist below
// serious/critical severity. Empty: no findings have needed a waiver so far.
// If axe reports something here, either fix it or add
// `{ page: '<path>', ruleId: '<rule>', owner: '<github handle>', reason: '...' }`.
const TRIAGED: readonly TriagedAxeViolation[] = []

function isTriaged(pagePath: string, ruleId: string): boolean {
  return TRIAGED.some((entry) => entry.page === pagePath && entry.ruleId === ruleId)
}

async function assertNoGatingViolations(page: Page, pagePath: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  const gating = results.violations.filter(
    (violation: AxeViolation) =>
      violation.impact != null &&
      GATING_IMPACTS.has(violation.impact) &&
      !isTriaged(pagePath, violation.id),
  )

  if (gating.length > 0) {
    const summary = gating
      .map((violation) => {
        const targets = violation.nodes.map((node) => `    ${node.target.join(' ')}`).join('\n')
        return `- [${violation.impact}] ${violation.id}: ${violation.help}\n  ${violation.helpUrl}\n${targets}`
      })
      .join('\n')
    throw new Error(`axe found serious/critical violations on ${pagePath}:\n${summary}`)
  }
}

test.describe('accessibility smoke (axe)', () => {
  test('discover has no serious/critical violations', async ({ page }) => {
    await page.goto('/en/discover')
    await expect(page.getByRole('heading', { name: /find the right accessible vehicle/i })).toBeVisible()

    await assertNoGatingViolations(page, '/en/discover')
  })

  test('results has no serious/critical violations', async ({ page }) => {
    await page.goto('/en/results')
    await expect(page.getByText(/vehicle found|vehicles found/i)).toBeVisible()

    await assertNoGatingViolations(page, '/en/results')
  })

  test('listing detail has no serious/critical violations', async ({ page }) => {
    await page.goto(`/en/vehicle/${fixtureListingId}`)
    await expect(page.getByRole('heading', { name: /2024 Toyota Sienna XLE/i })).toBeVisible()

    await assertNoGatingViolations(page, '/en/vehicle/[id]')
  })

  // Automated stand-in for the "keyboard-only pass ... confirms focus order
  // and visible focus" acceptance criterion: tabs several times per gated
  // page and asserts (a) each stop is a genuinely new, visible element (focus
  // moves forward rather than sticking or disappearing) and (b) each stop
  // renders a visible focus indicator (outline or box-shadow).
  const KEYBOARD_TAB_STOPS = 6

  async function assertTabOrderHasVisibleFocus(page: Page): Promise<void> {
    const seen = new Set<string>()

    for (let i = 0; i < KEYBOARD_TAB_STOPS; i += 1) {
      await page.keyboard.press('Tab')
      const focused = page.locator(':focus')
      await expect(focused).toBeVisible()

      const { outerHTML, indicator } = await focused.evaluate((el) => {
        const focusedStyle = window.getComputedStyle(el)
        const outlineStyle = focusedStyle.outlineStyle
        const outlineWidth = focusedStyle.outlineWidth
        const boxShadow = focusedStyle.boxShadow
        const focusedStrokeWidth = parseFloat(focusedStyle.strokeWidth || '0')

        // SVG shape elements (e.g. StateHeatMap's per-state <path>) style
        // focus via `stroke-width` instead of `outline`, since an outline
        // box reads poorly against an irregular path. Momentarily blur to
        // read the resting stroke-width, then refocus, so a real focus-time
        // increase is detected rather than assuming any baseline stroke
        // counts as a focus indicator.
        let baselineStrokeWidth = focusedStrokeWidth
        if (typeof (el as Partial<HTMLOrSVGElement>).blur === 'function') {
          ;(el as HTMLOrSVGElement).blur()
          baselineStrokeWidth = parseFloat(window.getComputedStyle(el).strokeWidth || '0')
          ;(el as HTMLOrSVGElement).focus()
        }

        return {
          outerHTML: el.outerHTML.slice(0, 120),
          indicator: { outlineStyle, outlineWidth, boxShadow, focusedStrokeWidth, baselineStrokeWidth },
        }
      })

      const hasVisibleFocus =
        (indicator.outlineStyle !== 'none' && indicator.outlineWidth !== '0px') ||
        indicator.boxShadow !== 'none' ||
        indicator.focusedStrokeWidth > indicator.baselineStrokeWidth
      expect(hasVisibleFocus, `stop ${i + 1} (${outerHTML}) has no visible focus indicator`).toBe(true)

      // Focus order: each stop should be a distinct element, i.e. Tab is
      // actually advancing rather than looping back onto the same node.
      expect(seen.has(outerHTML), `stop ${i + 1} repeats a previous focus target: ${outerHTML}`).toBe(false)
      seen.add(outerHTML)
    }
  }

  test('keyboard-only pass: discover has an in-order, visible focus sequence', async ({ page }) => {
    await page.goto('/en/discover')
    await expect(page.getByRole('heading', { name: /find the right accessible vehicle/i })).toBeVisible()

    await assertTabOrderHasVisibleFocus(page)
  })

  test('keyboard-only pass: results has an in-order, visible focus sequence', async ({ page }) => {
    await page.goto('/en/results')
    await expect(page.getByText(/vehicle found|vehicles found/i)).toBeVisible()

    await assertTabOrderHasVisibleFocus(page)
  })

  test('keyboard-only pass: listing detail has an in-order, visible focus sequence', async ({ page }) => {
    await page.goto(`/en/vehicle/${fixtureListingId}`)
    await expect(page.getByRole('heading', { name: /2024 Toyota Sienna XLE/i })).toBeVisible()

    await assertTabOrderHasVisibleFocus(page)
  })
})
