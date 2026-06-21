import type { ConversionType, RampType } from '@wivwav/types'

export interface ConversionProduct {
  id: string
  name: string
  conversionType: string
  rampType: string
  floorLoweringInches: number | null
  msrpCents: number | null
}

export interface ConversionBrandDetail {
  id: string
  name: string
  slug: string
  website: string | null
  nmedaCertified: boolean
  founded: number | null
  products: ConversionProduct[]
}

interface ListingConversionMatchInput {
  make: string
  model: string
  conversionType: ConversionType
  rampType: RampType
}

const BRAND_SLUG_ALIASES: Record<string, string> = {
  ams: 'ams-vans',
  'ams-and-vans': 'ams-vans',
  freedom: 'freedom-motors',
  rollx: 'rollx-vans',
  vantage: 'vantage-mobility',
  'vantage-mobility-international': 'vantage-mobility',
}

export function conversionBrandSlug(value: string | null | undefined): string | null {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!slug) return null

  return BRAND_SLUG_ALIASES[slug] ?? slug
}

export function matchConversionProduct(
  products: ConversionProduct[],
  listing: ListingConversionMatchInput,
): ConversionProduct | null {
  if (products.length === 0) return null

  const make = listing.make.toLowerCase()
  const model = listing.model.toLowerCase()

  const scored = products.map((product, index) => {
    const name = product.name.toLowerCase()
    const makeMatches = name.includes(make)
    const modelMatches = name.includes(model)
    let score = 0

    if (modelMatches) score += 8
    if (makeMatches) score += 3
    if (product.conversionType === listing.conversionType) score += 4
    if (product.rampType === listing.rampType) score += 2

    return { product, index, score: makeMatches || modelMatches ? score : 0 }
  })

  scored.sort((a, b) => b.score - a.score || a.index - b.index)

  const best = scored[0]
  return best && best.score > 0 ? best.product : null
}
