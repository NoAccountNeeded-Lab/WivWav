import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const baseUrl = (process.env.WIVWAV_BASE_URL || 'https://wivwav.com').replace(/\/$/, '')
const outputDir = process.env.WIVWAV_BASELINE_CAPTURE_DIR || '/private/tmp/wivwav-redesign-baseline'
const roundTrips = Number.parseInt(process.env.WIVWAV_BASELINE_ROUND_TRIPS || '3', 10)
if (!Number.isInteger(roundTrips) || roundTrips < 1 || roundTrips > 10) {
  throw new Error('WIVWAV_BASELINE_ROUND_TRIPS must be an integer from 1 to 10')
}

await mkdir(outputDir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const screenshots = []
const samples = []

async function takeScreenshot(size, route, filename) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.dpr,
  })
  const page = await context.newPage()
  const url = `${baseUrl}${route}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { level: 1 }).first().waitFor()
  await page.waitForTimeout(1200)
  const path = join(outputDir, filename)
  await page.screenshot({ path, fullPage: false })
  screenshots.push({ route, url, viewport: `${size.width}x${size.height}@${size.dpr}`, path })
  await context.close()
}

async function measure(page, label) {
  await page.waitForTimeout(1200)
  return page.evaluate(function (sampleLabel) {
    const resources = performance.getEntriesByType('resource')
    const images = Array.from(document.images)
    return {
      label: sampleLabel,
      route: location.pathname,
      viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
      resources: resources.length,
      facetRequests: resources.filter(function (entry) {
        return new URL(entry.name).pathname === '/v1/listings/facets'
      }).length,
      imageElements: images.length,
      loadedImages: images.filter(function (image) {
        return image.complete && image.naturalWidth > 0
      }).length,
      jsHeapBytes: performance.memory ? performance.memory.usedJSHeapSize : null,
      domElements: document.getElementsByTagName('*').length,
    }
  }, label)
}

try {
  const desktop = { width: 1710, height: 960, dpr: 2 }
  const mobile = { width: 390, height: 844, dpr: 3 }
  await takeScreenshot(desktop, '/', 'home-discover-desktop.png')
  await takeScreenshot(desktop, '/en/results', 'results-desktop.png')
  await takeScreenshot(mobile, '/', 'home-discover-mobile.png')
  await takeScreenshot(mobile, '/en/results', 'results-mobile.png')

  const context = await browser.newContext({
    viewport: { width: desktop.width, height: desktop.height },
    deviceScaleFactor: desktop.dpr,
  })
  const page = await context.newPage()
  await page.goto(`${baseUrl}/en`, { waitUntil: 'domcontentloaded' })
  samples.push(await measure(page, 'discover-0'))

  for (let cycle = 1; cycle <= roundTrips; cycle += 1) {
    await page.getByRole('link', { name: /See Matches/ }).click()
    await page.waitForFunction(function () { return location.pathname === '/en/results' })
    samples.push(await measure(page, `results-${cycle}`))
    await page.goBack({ waitUntil: 'commit' })
    await page.waitForFunction(function () { return location.pathname === '/en' })
    samples.push(await measure(page, `discover-${cycle}`))
  }
  await context.close()

  const report = {
    capturedAt: new Date().toISOString(),
    baseUrl,
    browser: { name: 'Chromium', version: browser.version() },
    routeModel: { '/': '/en', '/en': 'Discover', '/en/results': 'Results' },
    roundTrips,
    screenshots,
    samples,
    caveats: [
      'performance.memory is a Chromium-only approximate JavaScript heap value, not total browser memory.',
      'Resource and image counts are per-document snapshots after a 1200 ms settle; they do not measure every network cache or deferred image.',
      'Inventory and all counts are point-in-time and can change between runs.',
    ],
  }
  const reportPath = join(outputDir, 'measurement.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} finally {
  await browser.close()
}
