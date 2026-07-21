// Archived from issue #852's spike. Usage (run from apps/web, which has
// @playwright/test as a devDependency; pass the repo root as argv[2]):
//   1. cd spikes/852-mui-evaluation/ui-web && npx storybook build
//   2. python3 -m http.server 6853 --directory storybook-static &
//   3. cd ../../../apps/web && node ../spikes/852-mui-evaluation/scripts/a11y-probe.mjs <repo-root>
// Runs axe-core against the built Storybook's "Loaded"/"Running" stories
// and drives keyboard interaction (Tab/Escape/Arrow keys) against Dialog,
// Menu, and DataGrid — this produced the results archived at
// spikes/852-mui-evaluation/a11y-results.json and summarized in section 7
// of docs/design/852-mui-evaluation-spike.md.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = 'http://127.0.0.1:6853'
const REPO_ROOT = process.argv[2]
const axeDir = fs.readdirSync(REPO_ROOT + '/node_modules/.pnpm').find((d) => d.startsWith('axe-core@'))
const AXE_SRC = fs.readFileSync(
  REPO_ROOT + `/node_modules/.pnpm/${axeDir}/node_modules/axe-core/axe.min.js`,
  'utf8',
)

async function runAxe(page) {
  await page.addScriptTag({ content: AXE_SRC })
  const results = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    return await axe.run()
  })
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
  }))
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const report = {}

  // --- 1. Axe scan on populated stories ---
  const storyIds = [
    'apps-web-listing-detail-similar-listings--loaded',
    'apps-ops-run-detail-panel--running',
  ]
  for (const id of storyIds) {
    await page.goto(`${BASE}/iframe.html?id=${id}&viewMode=story`)
    await page.waitForSelector('#storybook-root')
    await page.waitForTimeout(300)
    const violations = await runAxe(page)
    report[id] = { axeViolations: violations }
  }

  // --- 2. Dialog keyboard: open, focus trap, Escape closes, focus returns ---
  {
    const id = 'apps-web-listing-detail-similar-listings--loaded'
    await page.goto(`${BASE}/iframe.html?id=${id}&viewMode=story`)
    await page.waitForSelector('#storybook-root')
    const reportBtn = page.getByRole('button', { name: 'Report listing' })
    await reportBtn.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible' })
    const dialogHasFocus = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]')
      return dlg ? dlg.contains(document.activeElement) : false
    })
    // Tab through the dialog and confirm focus never leaves it (focus trap)
    let trapped = true
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]')
        return dlg ? dlg.contains(document.activeElement) : false
      })
      if (!inside) trapped = false
    }
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' }).catch(() => {})
    const focusReturnedToTrigger = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') === 'Report listing',
    )
    report['dialog-keyboard'] = { dialogHasFocusOnOpen: dialogHasFocus, focusTrapped: trapped, focusReturnedToTrigger }
  }

  // --- 3. Menu keyboard: open via keyboard, arrow-navigate, Escape closes ---
  {
    const id = 'apps-web-listing-detail-similar-listings--loaded'
    await page.goto(`${BASE}/iframe.html?id=${id}&viewMode=story`)
    await page.waitForSelector('#storybook-root')
    const menuBtn = page.getByRole('button', { name: 'More actions' })
    await menuBtn.focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu')
    await menu.waitFor({ state: 'visible' })
    await page.keyboard.press('ArrowDown')
    const firstItemFocused = await page.evaluate(
      () => document.activeElement?.getAttribute('role') === 'menuitem',
    )
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'hidden' }).catch(() => {})
    const focusReturnedToTrigger = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') === 'More actions',
    )
    report['menu-keyboard'] = { firstItemFocusedOnArrowDown: firstItemFocused, focusReturnedToTrigger }
  }

  // --- 4. DataGrid keyboard: Tab into grid, arrow-navigate cells ---
  {
    const id = 'apps-web-listing-detail-similar-listings--loaded'
    await page.goto(`${BASE}/iframe.html?id=${id}&viewMode=story`)
    await page.waitForSelector('.MuiDataGrid-root')
    const grid = page.locator('.MuiDataGrid-root')
    const gridRole = await grid.getAttribute('role')
    // Click first cell, then arrow right/down and confirm aria-colindex/rowindex change
    const firstCell = page.locator('.MuiDataGrid-cell').first()
    await firstCell.click()
    const before = await page.evaluate(() => {
      const el = document.activeElement
      return { col: el?.getAttribute('aria-colindex'), row: el?.closest('[role="row"]')?.getAttribute('aria-rowindex') }
    })
    await page.keyboard.press('ArrowRight')
    const after = await page.evaluate(() => {
      const el = document.activeElement
      return { col: el?.getAttribute('aria-colindex'), row: el?.closest('[role="row"]')?.getAttribute('aria-rowindex') }
    })
    report['datagrid-keyboard'] = { gridRole, focusMovedOnArrowRight: before.col !== after.col, before, after }
  }

  await browser.close()
  console.log(JSON.stringify(report, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
