// Archived from issue #852's spike. Exploratory script used for section 6's
// SSR/hydration check against apps/ops's /inspector-preview route (chosen
// because it needs no DB/API). Requires: a real ops_session cookie value
// (log in via POST /api/login with OPS_ADMIN_USERNAME/PASSWORD set), the
// dev server running on port 4099, and @wivwav/spike-852-ui-web temporarily
// added as a dependency of apps/ops with a probe component wired into
// InspectorPreviewClient.tsx (all reverted before commit — see section 6's
// "Method" note). Not turnkey-runnable as-is; kept for methodology
// reference, not for unattended re-execution.
import { chromium } from '@playwright/test'

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  await context.addCookies([
    {
      name: 'ops_session',
      value: 'eyJleHAiOjE3ODQ2ODM0NzI3MzB9.WkvVtS2r3pSlCgjLimwlKgBY_49sgk4-ueKmQMGoXEU',
      domain: '127.0.0.1',
      path: '/',
    },
  ])
  const page = await context.newPage()
  const consoleMessages = []
  page.on('console', (msg) => consoleMessages.push({ type: msg.type(), text: msg.text() }))
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))

  const resp = await page.goto('http://127.0.0.1:4099/inspector-preview', { waitUntil: 'networkidle' })
  console.log('status:', resp.status())

  // Confirm SSR delivered real content before hydration by checking view-source (disable JS)
  const noJsContext = await browser.newContext({ javaScriptEnabled: false })
  await noJsContext.addCookies([
    {
      name: 'ops_session',
      value: 'eyJleHAiOjE3ODQ2ODM0NzI3MzB9.WkvVtS2r3pSlCgjLimwlKgBY_49sgk4-ueKmQMGoXEU',
      domain: '127.0.0.1',
      path: '/',
    },
  ])
  const noJsPage = await noJsContext.newPage()
  await noJsPage.goto('http://127.0.0.1:4099/inspector-preview')
  const noJsButtonText = await noJsPage.locator('text=MUI SSR probe button').count()
  const noJsHtml = await noJsPage.content()
  const hasEmotionStyleTag = /<style data-emotion/.test(noJsHtml)
  const hasMuiButtonClass = /MuiButton-root/.test(noJsHtml)

  await page.waitForTimeout(2000)
  const btn = page.getByRole('button', { name: 'MUI SSR probe button' })
  const btnVisibleAfterHydration = await btn.isVisible().catch(() => false)
  const btnCount = await btn.count()
  const outerHtml = await btn.first().evaluate((el) => el.outerHTML)
  console.log('btnCount:', btnCount, 'outerHtml:', outerHtml)
  const clickResult = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('MUI SSR probe button'))
    if (!el) return 'not-found'
    el.click()
    return 'clicked:' + el.outerHTML.slice(0, 120)
  })
  console.log('manual click result:', clickResult)

  // Sanity check: does a plain non-MUI button's onClick fire post-hydration?
  const plainBtnResult = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Open inspector'))
    if (!el) return 'not-found'
    el.click()
    return 'clicked-plain'
  })
  await page.waitForTimeout(300)
  const inspectorPanelOpened = await page
    .getByText('Deep-linked value:')
    .isVisible()
    .catch(() => false)
  console.log('plainBtnResult:', plainBtnResult, 'inspectorPanelOpened:', inspectorPanelOpened)

  // React version / hydration sanity: check for React DevTools hook presence and root state
  const reactInfo = await page.evaluate(() => {
    // @ts-expect-error probing global
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__
    return { hasDevtoolsHook: Boolean(hook) }
  })
  console.log('reactInfo:', JSON.stringify(reactInfo))
  await page.waitForTimeout(300)
  const dialog = page.getByRole('dialog')
  const dialogOpened = await dialog
    .waitFor({ state: 'visible', timeout: 4000 })
    .then(() => true)
    .catch(async (e) => {
      console.log('dialog wait failed:', String(e))
      return false
    })

  console.log(
    JSON.stringify(
      {
        noJs: { buttonTextPresentWithoutJs: noJsButtonText > 0, hasEmotionStyleTag, hasMuiButtonClass },
        withJs: { btnVisibleAfterHydration, dialogOpenedAfterClick: dialogOpened },
        consoleErrorsAndWarnings: consoleMessages.filter((m) => m.type === 'error' || m.type === 'warning'),
        pageErrors,
      },
      null,
      2,
    ),
  )

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
