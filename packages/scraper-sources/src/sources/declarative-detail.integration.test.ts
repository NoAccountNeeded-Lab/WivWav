/**
 * Fixture-driven integration tests for the declarative detail extractor
 * (#822), exercised end-to-end against Freedom Motors' seeded field
 * mappings and saved detail-page HTML.
 *
 * These tests use Playwright's real browser engine to run
 * evaluateDeclarativeDetail()'s page.evaluate() (including its XPath
 * label-text matching) against versioned HTML fixtures, then feed the
 * result through parseDeclarativeDetail() — the same two-step pipeline
 * detail-extract.ts uses in production.
 *
 * Excluded from the normal `pnpm test` run (integration.test.ts pattern).
 * Run with: pnpm --filter=@wivwav/scraper exec vitest run src --include src/sources/declarative-detail.integration.test.ts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import type { FieldMapping } from '@wivwav/types'
import { PlaywrightBrowserService } from '../browser/index.js'
import { evaluateDeclarativeDetail, parseDeclarativeDetail } from './declarative-detail.js'
import { FREEDOM_MOTORS_DETAIL_MAPPINGS } from './freedom-motors-detail-mappings.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureDir = join(__dirname, 'fixtures')

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf-8')
}

async function extract(fixtureName: string, mappings: FieldMapping[]) {
  const service = new PlaywrightBrowserService()
  const session = await service.launch()
  try {
    const page = await session.newPage()
    await page.setContent(loadFixture(fixtureName), { waitUntil: 'domcontentloaded' })
    const raw = await evaluateDeclarativeDetail(page, mappings)
    await page.close()
    return parseDeclarativeDetail(raw, mappings)
  } finally {
    await session.close()
  }
}

describe('declarative detail extractor — Freedom Motors seeded mappings (fm-v1: full spec block)', () => {
  it('extracts the full photo gallery, not just a single card thumbnail', async () => {
    const result = await extract('freedom-motors-detail-v1.html', FREEDOM_MOTORS_DETAIL_MAPPINGS)
    expect(result.images.length).toBeGreaterThan(1)
    expect(result.images).toEqual([
      'https://www.freedommotors.com/wp-content/uploads/2025/10/photo1.jpg',
      'https://www.freedommotors.com/wp-content/uploads/2025/10/photo2.jpg',
      'https://www.freedommotors.com/wp-content/uploads/2025/10/photo3.jpg',
      'https://www.freedommotors.com/wp-content/uploads/2025/10/photo4.jpg',
      'https://www.freedommotors.com/wp-content/uploads/2025/10/photo5.jpg',
    ])
  }, 30_000)

  it('extracts color, fuelType, engine, and transmission from the spec block', async () => {
    const result = await extract('freedom-motors-detail-v1.html', FREEDOM_MOTORS_DETAIL_MAPPINGS)
    expect(result.color).toBe('Ebony Black')
    expect(result.fuelType).toBe('Gasoline Fuel')
    expect(result.engine).toBe('Regular Unleaded V-6 3.8 L/231')
    expect(result.transmission).toBe('8-Speed Automatic w/OD')
  }, 30_000)

  it('derives an entry-direction claim from the Conversion Location spec field', async () => {
    const result = await extract('freedom-motors-detail-v1.html', FREEDOM_MOTORS_DETAIL_MAPPINGS)
    expect(result.conversionType).toBe('rear_entry')
    expect(result.evidence.accessibilityClaims).toBe('value')
  }, 30_000)

  it('derives active saleStatus from the Vehicle Status spec field', async () => {
    const result = await extract('freedom-motors-detail-v1.html', FREEDOM_MOTORS_DETAIL_MAPPINGS)
    expect(result.saleStatus).toBe('active')
  }, 30_000)

  it('does not pick up the related-products carousel, which reuses similarly-named attribute markup for a different vehicle', async () => {
    const result = await extract('freedom-motors-detail-v1.html', FREEDOM_MOTORS_DETAIL_MAPPINGS)
    // The carousel's Exterior Color is "Snow White Pearl" — must not leak in.
    expect(result.color).not.toBe('Snow White Pearl')
  }, 30_000)
})

describe('declarative detail extractor — Freedom Motors seeded mappings (fm-v2: missing Fuel Type)', () => {
  it('returns missing evidence for the one field whose selector matches nothing, without fabricating a value', async () => {
    const result = await extract('freedom-motors-detail-v2-missing-fuel-type.html', FREEDOM_MOTORS_DETAIL_MAPPINGS)
    expect(result.fuelType).toBeNull()
    expect(result.evidence.fuelType).toBe('missing')
  }, 30_000)

  it('still extracts every other mapped field on the same page', async () => {
    const result = await extract('freedom-motors-detail-v2-missing-fuel-type.html', FREEDOM_MOTORS_DETAIL_MAPPINGS)
    expect(result.color).toBe('Velvet Red Pearl')
    expect(result.engine).toBe('Regular Unleaded V-6 3.6 L/220')
    expect(result.transmission).toBe('9-Speed Automatic')
    expect(result.conversionType).toBe('side_entry')
    expect(result.images).toEqual(['https://www.freedommotors.com/wp-content/uploads/2025/11/photo1.jpg'])
  }, 30_000)
})

describe('declarative detail extractor — mappings drive extraction with no code change (#822)', () => {
  it('changes extraction output when only the Source.mappings selector changes, against the identical fixture page', async () => {
    const seededResult = await extract('freedom-motors-detail-v1.html', FREEDOM_MOTORS_DETAIL_MAPPINGS)
    expect(seededResult.color).toBe('Ebony Black')

    // Simulates an operator (or the AI remap loop's setMappings call)
    // repointing the 'color' mapping at a different spec row — same
    // extractor code, same page, different Source.mappings row.
    const retargetedMappings = FREEDOM_MOTORS_DETAIL_MAPPINGS.map((mapping) =>
      mapping.targetField === 'color'
        ? {
            ...mapping,
            selector: '//li[contains(@class,"product_attribute-row")][b[contains(text(),"Interior Color")]]/span',
          }
        : mapping,
    )
    const retargetedResult = await extract('freedom-motors-detail-v1.html', retargetedMappings)
    expect(retargetedResult.color).toBe('Black')
    expect(retargetedResult.color).not.toBe(seededResult.color)
  }, 30_000)

  it('stops matching (missing evidence) once a mapping selector is changed to a nonexistent field, with no code change', async () => {
    const brokenMappings = FREEDOM_MOTORS_DETAIL_MAPPINGS.map((mapping) =>
      mapping.targetField === 'engine'
        ? { ...mapping, selector: '//li[b[contains(text(),"Nonexistent Spec Field")]]/span' }
        : mapping,
    )
    const result = await extract('freedom-motors-detail-v1.html', brokenMappings)
    expect(result.engine).toBeNull()
    expect(result.evidence.engine).toBe('missing')
  }, 30_000)
})
