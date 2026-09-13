import { describe, it, expect } from 'vitest'
import { MobilityVanSalesAdapter } from './mobility-van-sales.js'

const liveNetwork = process.env['WIVWAV_LIVE_SCRAPER_TESTS'] === '1'

describe.skipIf(!liveNetwork)('MobilityVanSales live integration', () => {
  it('checkStructure returns a consistent hash', async () => {
    const adapter = new MobilityVanSalesAdapter(null)
    const result = await adapter.checkStructure()
    expect(result.currentHash).toHaveLength(64)
    expect(result.changed).toBe(false)
  })
})
