import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { report } from '../jobs/job-progress.js'
import seeds from '../seeds/nmeda-dealers.json' with { type: 'json' }

interface NmedaDealerSeed {
  name: string
  address: string | null
  state: string | null
  zip: string | null
  phone: string | null
  website: string | null
  qapCertified: boolean
}

export async function runNmedaDealersSeedJob(context?: JobContext): Promise<void> {
  const db = getDb()
  const dealerSeeds = seeds as NmedaDealerSeed[]

  await report(
    context,
    `[nmeda-dealers] Upserting ${dealerSeeds.length} dealer record(s)`,
    { stage: 'upserting', current: 0, total: dealerSeeds.length },
  )

  let upserted = 0

  for (let i = 0; i < dealerSeeds.length; i++) {
    const seed = dealerSeeds[i]!

    const existing = await db.nmeaDealer.findFirst({
      where: { name: seed.name },
      select: { id: true },
    })

    const payload = {
      address: seed.address,
      state: seed.state,
      zip: seed.zip,
      phone: seed.phone,
      website: seed.website,
      qapCertified: seed.qapCertified,
    }

    if (existing) {
      await db.nmeaDealer.update({ where: { id: existing.id }, data: payload })
    } else {
      await db.nmeaDealer.create({ data: { name: seed.name, ...payload } })
    }

    upserted++

    await report(
      context,
      `[nmeda-dealers] ${i + 1}/${dealerSeeds.length} — ${seed.name}`,
      { stage: 'upserting', current: i + 1, total: dealerSeeds.length },
    )
  }

  await report(context, `[nmeda-dealers] Done. ${upserted} dealer(s) upserted.`, {
    stage: 'complete',
    current: upserted,
    total: dealerSeeds.length,
  })
  await db.$disconnect()
}
