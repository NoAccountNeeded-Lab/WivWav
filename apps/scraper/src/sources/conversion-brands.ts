import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { report } from '../jobs/job-progress.js'
import seeds from '../seeds/conversion-brands.json' with { type: 'json' }

interface ProductSeed {
  name: string
  conversionType: 'rear_entry' | 'side_entry' | 'unknown'
  rampType: 'in_floor' | 'fold_out' | 'fold_in' | 'none' | 'unknown'
  floorLoweringInches: number | null
  msrpCents: number | null
}

interface BrandSeed {
  name: string
  slug: string
  website: string
  nmedaCertified: boolean
  founded: number | null
  products: ProductSeed[]
}

export async function runConversionBrandsSeedJob(context?: JobContext): Promise<void> {
  const db = getDb()
  const brandSeeds = seeds as BrandSeed[]

  await report(
    context,
    `[conversion-brands] Upserting ${brandSeeds.length} brand record(s)`,
    { stage: 'upserting', current: 0, total: brandSeeds.length },
  )

  let upserted = 0

  for (let i = 0; i < brandSeeds.length; i++) {
    const seed = brandSeeds[i]!

    const brand = await db.conversionBrand.upsert({
      where: { slug: seed.slug },
      create: {
        name: seed.name,
        slug: seed.slug,
        website: seed.website,
        nmedaCertified: seed.nmedaCertified,
        founded: seed.founded,
      },
      update: {
        name: seed.name,
        website: seed.website,
        nmedaCertified: seed.nmedaCertified,
        founded: seed.founded,
      },
    })

    for (const product of seed.products) {
      const existing = await db.conversionProduct.findFirst({
        where: { brandId: brand.id, name: product.name },
        select: { id: true },
      })

      if (existing) {
        await db.conversionProduct.update({
          where: { id: existing.id },
          data: {
            conversionType: product.conversionType,
            rampType: product.rampType,
            floorLoweringInches: product.floorLoweringInches,
            msrpCents: product.msrpCents,
          },
        })
      } else {
        await db.conversionProduct.create({
          data: {
            brandId: brand.id,
            name: product.name,
            conversionType: product.conversionType,
            rampType: product.rampType,
            floorLoweringInches: product.floorLoweringInches,
            msrpCents: product.msrpCents,
          },
        })
      }
    }

    upserted++

    await report(
      context,
      `[conversion-brands] ${i + 1}/${brandSeeds.length} — ${seed.name}`,
      { stage: 'upserting', current: i + 1, total: brandSeeds.length },
    )
  }

  await report(context, `[conversion-brands] Done. ${upserted} brand(s) upserted.`, {
    stage: 'complete',
    current: upserted,
    total: brandSeeds.length,
  })
  await db.$disconnect()
}
