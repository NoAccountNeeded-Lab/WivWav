import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PlaywrightBrowserService } from '../browser/index.js'
import type { BrowserPage, BrowserSession } from '../browser/index.js'
import { evaluateBlvdCards, parseCard as parseBlvdCard } from './blvd.js'
import type { RawCard as BlvdRawCard } from './blvd.js'
import { evaluateBlvdDetail, parseBlvdDetail } from './blvd-detail.js'
import type { RawDetail as BlvdRawDetail } from './blvd-detail.js'
import { evaluateMobilityWorksCards, parseCard as parseMobilityWorksCard } from './mobilityworks.js'
import type { RawCard as MobilityWorksRawCard } from './mobilityworks.js'
import { evaluateMwDetail, parseMwDetail } from './mobilityworks-detail.js'
import type { RawMwDetail } from './mobilityworks-detail.js'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'contracts')

type SourceId = 'blvd' | 'mobilityworks'

interface FacetOutput {
  make: string
  model: string
  trim: string | null
  year: number
  priceCents: number | null
  mileage: number | null
  condition: string
  sellerType: string
  state: string | null
  color: string | null
  conversionType: string
  conversionManufacturer: string | null
  rampType: string
  wavFeatures: string[]
}

interface ContractCase {
  id: string
  source: SourceId
  listFixture: string
  cardIndex: number
  detailFixture: string
  expected: FacetOutput
}

interface ContractManifest {
  schemaVersion: number
  facetFields: Array<keyof FacetOutput>
  cases: ContractCase[]
  recrawl: {
    source: 'blvd'
    fixture: string
    cardIndex: number
    sourceRecordKey: string
    expectedPriceCents: number
    expectedMileage: number
    detailOwnedFields: {
      color: null
      rampType: 'unknown'
      wavFeatures: []
    }
  }
}

type RawContract =
  | { source: 'blvd'; card: BlvdRawCard; detail: BlvdRawDetail }
  | { source: 'mobilityworks'; card: MobilityWorksRawCard; detail: RawMwDetail }

const manifest = JSON.parse(
  readFileSync(join(fixtureDir, 'expected.json'), 'utf8'),
) as ContractManifest

let session: BrowserSession | undefined
const rawById = new Map<string, RawContract>()

function fixtureHtml(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8')
}

async function openFixture(name: string): Promise<BrowserPage> {
  if (!session) throw new Error('Fixture browser session is not initialized')
  const page = await session.newPage({ failOnExternalRequests: true })
  await page.setContent(fixtureHtml(name), { waitUntil: 'load' })
  return page
}

async function extractRaw(contractCase: ContractCase): Promise<RawContract> {
  const listPage = await openFixture(contractCase.listFixture)
  const detailPage = await openFixture(contractCase.detailFixture)
  try {
    if (contractCase.source === 'blvd') {
      const cards = await evaluateBlvdCards(listPage)
      const card = cards[contractCase.cardIndex]
      if (!card) throw new Error(`Missing BLVD card index ${contractCase.cardIndex}`)
      return {
        source: 'blvd',
        card,
        detail: await evaluateBlvdDetail(detailPage),
      }
    }

    const cards = await evaluateMobilityWorksCards(listPage)
    const card = cards[contractCase.cardIndex]
    if (!card) throw new Error(`Missing MobilityWorks card index ${contractCase.cardIndex}`)
    return {
      source: 'mobilityworks',
      card,
      detail: await evaluateMwDetail(detailPage),
    }
  } finally {
    await listPage.close()
    await detailPage.close()
  }
}

function projectFacets(raw: RawContract): FacetOutput {
  if (raw.source === 'blvd') {
    const listing = parseBlvdCard(raw.card)
    if (!listing) throw new Error('BLVD fixture card did not parse')
    const detail = parseBlvdDetail(raw.detail)
    return {
      make: listing.make,
      model: listing.model,
      trim: listing.trim,
      year: listing.year,
      priceCents: listing.priceCents,
      mileage: listing.mileage,
      condition: listing.condition,
      sellerType: listing.sellerType,
      state: listing.location.state,
      color: detail.color,
      conversionType: listing.wav.conversionType,
      conversionManufacturer: listing.wav.conversionManufacturer,
      rampType: detail.rampType,
      wavFeatures: detail.wavFeatures,
    }
  }

  const listing = parseMobilityWorksCard(raw.card)
  if (!listing) throw new Error('MobilityWorks fixture card did not parse')
  const detail = parseMwDetail(raw.detail)
  return {
    make: listing.make,
    model: listing.model,
    trim: listing.trim,
    year: listing.year,
    priceCents: listing.priceCents,
    mileage: listing.mileage,
    condition: listing.condition,
    sellerType: listing.sellerType,
    state: listing.location.state,
    color: detail.color,
    conversionType: listing.wav.conversionType,
    conversionManufacturer: listing.wav.conversionManufacturer,
    rampType: detail.rampType,
    wavFeatures: detail.wavFeatures,
  }
}

function rawCase(id: string): RawContract {
  const raw = rawById.get(id)
  if (!raw) throw new Error(`Fixture case "${id}" was not extracted`)
  return raw
}

beforeAll(async () => {
  session = await new PlaywrightBrowserService().launch()
  for (const contractCase of manifest.cases) {
    rawById.set(contractCase.id, await extractRaw(contractCase))
  }
}, 30_000)

afterAll(async () => {
  await session?.close()
  rawById.clear()
})

describe('offline source fixture contracts', () => {
  it('covers every public facet field in every hand-authored expected output', () => {
    const expectedFields = [...manifest.facetFields].sort()
    for (const contractCase of manifest.cases) {
      expect(Object.keys(contractCase.expected).sort()).toEqual(expectedFields)
    }
  })

  for (const contractCase of manifest.cases) {
    it(`${contractCase.id} extracts production DOM selectors into exact facet output`, () => {
      expect(projectFacets(rawCase(contractCase.id))).toEqual(contractCase.expected)
    })
  }

  it('covers missing descriptions, missing galleries, and unknown ramp values', () => {
    const blvdRaw = rawCase('blvd-edge')
    const mobilityWorksRaw = rawCase('mobilityworks-edge')
    if (blvdRaw.source !== 'blvd' || mobilityWorksRaw.source !== 'mobilityworks') {
      throw new Error('Edge fixture source mismatch')
    }

    expect(blvdRaw.detail).toMatchObject({
      descriptionFound: false,
      galleryFound: false,
      descriptionText: '',
      imageUrls: [],
    })
    expect(mobilityWorksRaw.detail).toMatchObject({
      descriptionFound: false,
      galleryFound: false,
      descriptionText: '',
      imageUrls: [],
    })
    expect(projectFacets(blvdRaw).rampType).toBe('unknown')
    expect(projectFacets(mobilityWorksRaw).rampType).toBe('unknown')
  })

  it('fails closed when fixture HTML attempts an external request', async () => {
    if (!session) throw new Error('Fixture browser session is not initialized')
    const page = await session.newPage({ failOnExternalRequests: true })
    try {
      await expect(
        page.setContent('<img src="https://unexpected.invalid/tracker.png">', {
          waitUntil: 'networkidle',
        }),
      ).rejects.toThrow('Offline fixture attempted external request')
    } finally {
      await page.close()
    }
  }, 30_000)

  it('keeps facet outputs deterministic across clocks and time zones', () => {
    const rawCases = manifest.cases.map((contractCase) => rawCase(contractCase.id))

    const originalTz = process.env['TZ']
    vi.useFakeTimers()
    try {
      process.env['TZ'] = 'UTC'
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      const first = rawCases.map(projectFacets)

      process.env['TZ'] = 'Pacific/Kiritimati'
      vi.setSystemTime(new Date('2030-12-31T23:59:59.000Z'))
      const second = rawCases.map(projectFacets)

      expect(second).toEqual(first)
    } finally {
      vi.useRealTimers()
      if (originalTz === undefined) delete process.env['TZ']
      else process.env['TZ'] = originalTz
    }
  })

  it('models a versioned card recrawl without detail-owned accessibility fields', async () => {
    const baselineCase = manifest.cases.find((entry) => entry.id === 'blvd-normal')
    if (!baselineCase || !session) throw new Error('BLVD baseline fixture is missing')

    const baselinePage = await openFixture(baselineCase.listFixture)
    const recrawlPage = await openFixture(manifest.recrawl.fixture)
    try {
      const baselineRaw = (await evaluateBlvdCards(baselinePage))[baselineCase.cardIndex]
      const recrawlRaw = (await evaluateBlvdCards(recrawlPage))[manifest.recrawl.cardIndex]
      if (!baselineRaw || !recrawlRaw) throw new Error('BLVD recrawl card is missing')

      const baseline = parseBlvdCard(baselineRaw)
      const recrawl = parseBlvdCard(recrawlRaw)
      if (!baseline || !recrawl) throw new Error('BLVD recrawl card did not parse')

      expect(recrawl.sourceRecordKey).toBe(manifest.recrawl.sourceRecordKey)
      expect(recrawl.sourceRecordKey).toBe(baseline.sourceRecordKey)
      expect(recrawl.priceCents).toBe(manifest.recrawl.expectedPriceCents)
      expect(recrawl.priceCents).not.toBe(baseline.priceCents)
      expect(recrawl.mileage).toBe(manifest.recrawl.expectedMileage)
      expect(recrawl.mileage).not.toBe(baseline.mileage)
      expect({
        color: recrawl.color,
        rampType: recrawl.wav.rampType,
        wavFeatures: recrawl.wav.wavFeatures,
      }).toEqual(manifest.recrawl.detailOwnedFields)
    } finally {
      await baselinePage.close()
      await recrawlPage.close()
    }
  }, 30_000)

  it('keeps contract HTML sanitized and free of executable or tracking markup', () => {
    const htmlFiles = readdirSync(fixtureDir).filter((name) => name.endsWith('.html'))
    expect(htmlFiles.length).toBeGreaterThanOrEqual(7)
    for (const name of htmlFiles) {
      const html = fixtureHtml(name)
      expect(html).not.toMatch(/<script\b/i)
      expect(html).not.toMatch(/(?:analytics|tracking|pixel|doubleclick|googletagmanager)/i)
      expect(html).not.toMatch(/mailto:|@[a-z0-9.-]+\.[a-z]{2,}/i)
    }
  })
})
