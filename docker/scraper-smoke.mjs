import { readdir } from 'node:fs/promises'
import process from 'node:process'
import sharp from 'sharp'

const uid = process.getuid?.()
if (uid === undefined || uid === 0) {
  throw new Error(`scraper smoke test must run as non-root; uid=${String(uid)}`)
}

const virtualStoreEntries = await readdir('node_modules/.pnpm')
const forbiddenRuntimePackages = [
  'typescript',
  'vitest',
  'eslint',
  'prettier',
  'turbo',
  '@playwright+test',
  'playwright',
  'playwright-core',
  'playwright-extra',
]
for (const packageName of forbiddenRuntimePackages) {
  if (virtualStoreEntries.some((entry) => entry.startsWith(`${packageName}@`))) {
    throw new Error(`development package found in runtime tree: ${packageName}`)
  }
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

console.log(
  JSON.stringify({
    browserRuntime: 'absent',
    sharp: sharp.versions.sharp,
    uid,
  }),
)
