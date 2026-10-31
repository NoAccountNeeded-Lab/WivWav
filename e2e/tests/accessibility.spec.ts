import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import type { TriagedAxeViolation } from '../support/axe.js'
import { assertNoGatingViolations as assertNoGatingViolationsBase } from '../support/axe.js'
import { fixtureListingId } from '../support/fixture.js'

// Issue #673 / decision D9 (#666): every user-facing page must meet WCAG 2.1
// AA. This runs axe-core (support/axe.ts) against the same built-container
// app the smoke suite in smoke.spec.ts already boots (see
// e2e/support/global-setup.ts), rather than a parallel harness, and fails CI
// on serious/critical violations. Moderate/minor findings are reported but
// not gating; triage any that appear into the list below with an owner
// instead of loosening the assertion.

// Known, already-triaged violations that are allowed to persist below
// serious/critical severity. Empty: no findings have needed a waiver so far.
// If axe reports something here, either fix it or add
// `{ page: '<path>', ruleId: '<rule>', owner: '<github handle>', reason: '...' }`.
const TRIAGED: readonly TriagedAxeViolation[] = []

async function assertNoGatingViolations(page: Page, pagePath: string): Promise<void> {
  await assertNoGatingViolationsBase(page, pagePath, TRIAGED)
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

      const { outerHTML, indicator } = await focused.evaluate(async (el) => {
        // Focus styling can be CSS-transitioned (e.g. StateHeatMap's
        // stroke-width animates over 0.15s), so let any in-flight
        // transition settle before reading computed style — otherwise we
        // race the animation and read a mid-transition value.
        const waitForStyleSettle = async () => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          await Promise.allSettled((el as Element).getAnimations().map((a) => a.finished))
        }
        await waitForStyleSettle()

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
          await waitForStyleSettle()
          baselineStrokeWidth = parseFloat(window.getComputedStyle(el).strokeWidth || '0')
          ;(el as HTMLOrSVGElement).focus()
        }

        return {
          outerHTML: el.outerHTML,
          indicator: { outlineStyle, outlineWidth, boxShadow, focusedStrokeWidth, baselineStrokeWidth },
        }
      })

      const hasVisibleFocus =
        (indicator.outlineStyle !== 'none' && indicator.outlineWidth !== '0px') ||
        indicator.boxShadow !== 'none' ||
        indicator.focusedStrokeWidth > indicator.baselineStrokeWidth
      expect(hasVisibleFocus, `stop ${i + 1} (${outerHTML.slice(0, 120)}) has no visible focus indicator`).toBe(true)

      // Focus order: each stop should be a distinct element, i.e. Tab is
      // actually advancing rather than looping back onto the same node. Uses
      // the full outerHTML (not a truncated prefix) since sibling controls
      // with identical markup shape (e.g. BarsRenderer's bar buttons) share
      // the same first ~100 chars and only diverge in their label/count text.
      expect(seen.has(outerHTML), `stop ${i + 1} repeats a previous focus target: ${outerHTML.slice(0, 120)}`).toBe(false)
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

    // StateHeatMap loads via next/dynamic (ssr: false) and fetches its
    // topojson data client-side, independently of the "vehicles found" text
    // above. Its interactive <path> elements aren't in the DOM until that
    // resolves, so tabbing before it's ready makes focus land on whatever
    // comes after it instead — a race, not a real focus-order bug. Wait for
    // the map to be interactive so the tab sequence below is deterministic.
    await expect(page.locator('[role="group"][aria-label*="Map of the United States"] [role="button"]').first()).toBeAttached()

    await assertTabOrderHasVisibleFocus(page)
  })

  test('state heat map focus distinguishes the maximum fill without weakening other states', async ({
    page,
  }) => {
    await page.goto('/en/results')
    await expect(page.getByText(/vehicle found|vehicles found/i)).toBeVisible()

    const map = page.locator('[role="group"][aria-label*="Map of the United States"]')
    const states = map.locator('[role="button"]')
    await expect(states.first()).toBeAttached()

    const maxState = map.locator('[role="button"][data-max-count="true"]').first()
    const otherState = map.locator('[role="button"][data-max-count="false"]').first()

    // `states.first()` above only proves the map shell rendered — every state
    // button exists regardless of data. `data-max-count` is derived from the
    // stats fetch StateHeatMap loads independently (see comment above), so
    // wait for it explicitly here too; otherwise a slow-loading fetch fails
    // the unguarded `.evaluate()` calls below only after burning the entire
    // test timeout, with no indication of what was actually still missing.
    await expect(maxState).toBeAttached()
    await expect(otherState).toBeAttached()

    const baselineWidths = await Promise.all([
      maxState.evaluate(function getStrokeWidth(state) {
        return parseFloat(window.getComputedStyle(state).strokeWidth)
      }),
      otherState.evaluate(function getStrokeWidth(state) {
        return parseFloat(window.getComputedStyle(state).strokeWidth)
      }),
    ])

    await maxState.focus()
    const maxFocusStyle = await maxState.evaluate(function getFocusStyle(state) {
      const style = window.getComputedStyle(state)

      function renderedRgba(color: string): number[] {
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas 2D context is unavailable')

        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        return Array.from(context.getImageData(0, 0, 1, 1).data)
      }

      return {
        fillRgba: renderedRgba(style.fill),
        strokeRgba: renderedRgba(style.stroke),
        strokeWidth: parseFloat(style.strokeWidth),
      }
    })

    await otherState.focus()
    const otherFocusWidth = await otherState.evaluate(function getStrokeWidth(state) {
      return parseFloat(window.getComputedStyle(state).strokeWidth)
    })

    expect(maxFocusStyle.strokeRgba).not.toEqual(maxFocusStyle.fillRgba)
    expect(maxFocusStyle.strokeWidth).toBeGreaterThan(baselineWidths[0])
    expect(otherFocusWidth).toBeGreaterThan(baselineWidths[1])
  })

  test('keyboard-only pass: listing detail has an in-order, visible focus sequence', async ({ page }) => {
    await page.goto(`/en/vehicle/${fixtureListingId}`)
    await expect(page.getByRole('heading', { name: /2024 Toyota Sienna XLE/i })).toBeVisible()

    await assertTabOrderHasVisibleFocus(page)
  })
})
