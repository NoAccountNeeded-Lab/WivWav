import { readdir } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const uid = process.getuid?.()
if (uid === undefined || uid === 0) {
  throw new Error(`scraper smoke test must run as non-root; uid=${String(uid)}`)
}

const virtualStoreEntries = await readdir('node_modules/.pnpm')
const forbiddenRuntimePackages = ['typescript', 'vitest', 'eslint', 'prettier', 'turbo']
for (const packageName of forbiddenRuntimePackages) {
  if (virtualStoreEntries.some((entry) => entry.startsWith(`${packageName}@`))) {
    throw new Error(`development package found in runtime tree: ${packageName}`)
  }
}

const browserRoot = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/ms-playwright'
const browserEntries = (await readdir(browserRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
const headlessShells = browserEntries.filter((entry) =>
  entry.startsWith('chromium_headless_shell-'),
)
const unusedBrowsers = browserEntries.filter((entry) => /^(?:chromium|firefox|webkit)-/.test(entry))

if (headlessShells.length !== 1) {
  throw new Error(`expected one Chromium headless shell; found: ${browserEntries.join(', ')}`)
}
if (unusedBrowsers.length > 0) {
  throw new Error(`unused browser installation found: ${unusedBrowsers.join(', ')}`)
}

const image = await sharp({
  create: {
    width: 1,
    height: 1,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 1 },
  },
})
  .png()
  .toBuffer()
if (image.length === 0) {
  throw new Error('sharp returned an empty image')
}

const browser = await chromium.launch({ chromiumSandbox: true })
try {
  const page = await browser.newPage()
  await page.setContent('<title>WivWav scraper smoke</title>')
  const title = await page.title()
  if (title !== 'WivWav scraper smoke') {
    throw new Error(`unexpected Chromium smoke title: ${title}`)
  }
} finally {
  await browser.close()
}

console.log(
  JSON.stringify({
    browser: headlessShells[0],
    chromiumSandbox: true,
    sharp: sharp.versions.sharp,
    uid,
  }),
)
