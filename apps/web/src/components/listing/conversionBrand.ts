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

export function conversionBrandSlug(value: string | null | undefined): string | null {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug ? slug : null
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
    let score = 0

    if (name.includes(model)) score += 8
    if (name.includes(make)) score += 3
    if (product.conversionType === listing.conversionType) score += 4
    if (product.rampType === listing.rampType) score += 2

    return { product, index, score }
  })

  scored.sort((a, b) => b.score - a.score || a.index - b.index)

  const best = scored[0]
  return best && best.score > 0 ? best.product : (products[0] ?? null)
}
