import type { PrismaClient } from '@wivwav/db'

export interface ConversionBrandSummary {
  id: string
  name: string
  slug: string
  website: string | null
  nmedaCertified: boolean
  founded: number | null
  productCount: number
}

export interface ConversionProductRow {
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
  products: ConversionProductRow[]
}

export interface ConversionBrandRepository {
  findAll(): Promise<ConversionBrandSummary[]>
  findBySlug(slug: string): Promise<ConversionBrandDetail | null>
}

export class PrismaConversionBrandRepository implements ConversionBrandRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAll(): Promise<ConversionBrandSummary[]> {
    const brands = await this.db.conversionBrand.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    })

    return brands.map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      website: b.website,
      nmedaCertified: b.nmedaCertified,
      founded: b.founded,
      productCount: b._count.products,
    }))
  }

  async findBySlug(slug: string): Promise<ConversionBrandDetail | null> {
    const brand = await this.db.conversionBrand.findUnique({
      where: { slug },
      include: {
        products: {
          orderBy: { name: 'asc' },
        },
      },
    })

    if (!brand) return null

    return {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      website: brand.website,
      nmedaCertified: brand.nmedaCertified,
      founded: brand.founded,
      products: brand.products.map((p) => ({
        id: p.id,
        name: p.name,
        conversionType: p.conversionType,
        rampType: p.rampType,
        floorLoweringInches: p.floorLoweringInches,
        msrpCents: p.msrpCents,
      })),
    }
  }
}
