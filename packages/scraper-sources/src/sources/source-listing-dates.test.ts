import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PlaywrightBrowserService } from '../browser/index.js'
import type { BrowserSession } from '../browser/index.js'
import { evaluateSourceListingDates, parseSourceListingDates } from './source-listing-dates.js'

describe('parseSourceListingDates', () => {
  it('normalizes source-provided listing and update dates', () => {
    expect(parseSourceListingDates({
      listedAt: '2026-05-01T12:30:00-04:00',
      updatedAt: '2026-05-03T09:15:00Z',
    })).toEqual({
      sourceListedAt: new Date('2026-05-01T16:30:00.000Z'),
      sourceUpdatedAt: new Date('2026-05-03T09:15:00.000Z'),
    })
  })

  it('returns null for missing or invalid source dates', () => {
    expect(parseSourceListingDates({ listedAt: '', updatedAt: 'not-a-date' })).toEqual({
      sourceListedAt: null,
      sourceUpdatedAt: null,
    })
  })
})

describe('evaluateSourceListingDates', () => {
  let session: BrowserSession

  beforeAll(async () => {
    session = await new PlaywrightBrowserService().launch()
  })

  afterAll(async () => {
    await session.close()
  })

  it('extracts dates from listing-scoped JSON-LD', async () => {
    const page = await session.newPage()
    try {
      await page.setContent(`
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"Product","datePublished":"2026-05-01T12:00:00Z","dateModified":"2026-05-03T12:00:00Z"}
        </script>
      `)

      await expect(evaluateSourceListingDates(page, {
        expectedUrl: 'https://dealer.example.com/inventory/current-van',
      })).resolves.toEqual({
        sourceListedAt: new Date('2026-05-01T12:00:00Z'),
        sourceUpdatedAt: new Date('2026-05-03T12:00:00Z'),
      })
    } finally {
      await page.close()
    }
  })

  it('extracts dates from listing-scoped microdata', async () => {
    const page = await session.newPage()
    try {
      await page.setContent(`
        <main itemscope itemtype="https://schema.org/Vehicle">
          <time itemprop="datePosted" datetime="2026-04-10T08:00:00Z"></time>
          <meta itemprop="dateModified" content="2026-04-12T09:00:00Z">
        </main>
      `)

      await expect(evaluateSourceListingDates(page, {
        expectedUrl: 'https://dealer.example.com/inventory/current-van',
      })).resolves.toEqual({
        sourceListedAt: new Date('2026-04-10T08:00:00Z'),
        sourceUpdatedAt: new Date('2026-04-12T09:00:00Z'),
      })
    } finally {
      await page.close()
    }
  })

  it('ignores dates scoped to editorial articles', async () => {
    const page = await session.newPage()
    try {
      await page.setContent(`
        <article itemscope itemtype="https://schema.org/Article">
          <time itemprop="datePublished" datetime="2026-04-10T08:00:00Z"></time>
        </article>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"Article","datePublished":"2026-04-10T08:00:00Z"}
        </script>
      `)

      await expect(evaluateSourceListingDates(page, {
        expectedUrl: 'https://dealer.example.com/inventory/current-van',
      })).resolves.toEqual({
        sourceListedAt: null,
        sourceUpdatedAt: null,
      })
    } finally {
      await page.close()
    }
  })

  it('selects the current main-entity listing when an unrelated Product appears first', async () => {
    const page = await session.newPage()
    try {
      await page.setContent(`
        <script type="application/ld+json">
          [
            {
              "@context":"https://schema.org",
              "@type":"Product",
              "url":"https://dealer.example.com/inventory/unrelated-van",
              "datePublished":"2025-01-01T00:00:00Z"
            },
            {
              "@context":"https://schema.org",
              "@type":"WebPage",
              "@id":"https://dealer.example.com/inventory/current-van#page",
              "mainEntity":{
                "@type":"Vehicle",
                "@id":"https://dealer.example.com/inventory/current-van#vehicle",
                "vehicleIdentificationNumber":"5TDYRKEC8RS205440",
                "datePublished":"2026-05-01T12:00:00Z",
                "dateModified":"2026-05-03T12:00:00Z"
              }
            }
          ]
        </script>
      `)

      await expect(evaluateSourceListingDates(page, {
        expectedUrl: 'https://dealer.example.com/inventory/current-van',
        expectedVin: '5TDYRKEC8RS205440',
      })).resolves.toEqual({
        sourceListedAt: new Date('2026-05-01T12:00:00Z'),
        sourceUpdatedAt: new Date('2026-05-03T12:00:00Z'),
      })
    } finally {
      await page.close()
    }
  })

  it('does not merge an unrelated anonymous microdata date into a proven JSON-LD listing', async () => {
    const page = await session.newPage()
    try {
      await page.setContent(`
        <script type="application/ld+json">
          {
            "@context":"https://schema.org",
            "@type":"Product",
            "url":"https://dealer.example.com/inventory/current-van",
            "datePublished":"2026-05-01T12:00:00Z"
          }
        </script>
        <aside itemscope itemtype="https://schema.org/Vehicle">
          <meta itemprop="dateModified" content="2025-01-03T00:00:00Z">
        </aside>
      `)

      await expect(evaluateSourceListingDates(page, {
        expectedUrl: 'https://dealer.example.com/inventory/current-van',
      })).resolves.toEqual({
        sourceListedAt: new Date('2026-05-01T12:00:00Z'),
        sourceUpdatedAt: null,
      })
    } finally {
      await page.close()
    }
  })

  it('merges complementary dates from duplicate candidates with the same proven identity', async () => {
    const page = await session.newPage()
    try {
      await page.setContent(`
        <script type="application/ld+json">
          {
            "@context":"https://schema.org",
            "@type":"Product",
            "url":"https://dealer.example.com/inventory/current-van",
            "datePublished":"2026-05-01T12:00:00Z"
          }
        </script>
        <main
          itemscope
          itemtype="https://schema.org/Vehicle"
          itemid="https://dealer.example.com/inventory/current-van#vehicle"
        >
          <meta itemprop="dateModified" content="2026-05-03T12:00:00Z">
        </main>
      `)

      await expect(evaluateSourceListingDates(page, {
        expectedUrl: 'https://dealer.example.com/inventory/current-van',
      })).resolves.toEqual({
        sourceListedAt: new Date('2026-05-01T12:00:00Z'),
        sourceUpdatedAt: new Date('2026-05-03T12:00:00Z'),
      })
    } finally {
      await page.close()
    }
  })

  it('fails a conflicting same-identity date field closed while preserving a non-conflicting field', async () => {
    const page = await session.newPage()
    try {
      await page.setContent(`
        <script type="application/ld+json">
          {
            "@context":"https://schema.org",
            "@type":"Product",
            "url":"https://dealer.example.com/inventory/current-van",
            "datePublished":"2026-05-01T12:00:00Z",
            "dateModified":"2026-05-03T12:00:00Z"
          }
        </script>
        <main
          itemscope
          itemtype="https://schema.org/Vehicle"
          itemid="https://dealer.example.com/inventory/current-van#vehicle"
        >
          <time itemprop="datePosted" datetime="2026-05-02T12:00:00Z"></time>
        </main>
      `)

      await expect(evaluateSourceListingDates(page, {
        expectedUrl: 'https://dealer.example.com/inventory/current-van',
      })).resolves.toEqual({
        sourceListedAt: null,
        sourceUpdatedAt: new Date('2026-05-03T12:00:00Z'),
      })
    } finally {
      await page.close()
    }
  })

  it('returns null for an ambiguous multi-listing page without a matching identity', async () => {
    const page = await session.newPage()
    try {
      await page.setContent(`
        <script type="application/ld+json">
          [
            {"@type":"Product","datePublished":"2025-01-01T00:00:00Z"},
            {"@type":"Vehicle","datePublished":"2026-05-01T12:00:00Z"}
          ]
        </script>
      `)

      await expect(evaluateSourceListingDates(page, {
        expectedUrl: 'https://dealer.example.com/inventory/current-van',
      })).resolves.toEqual({
        sourceListedAt: null,
        sourceUpdatedAt: null,
      })
    } finally {
      await page.close()
    }
  })
})
