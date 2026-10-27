import { describe, expect, it, vi } from 'vitest'
import { readWorkerSetting } from './operator-setting.js'

describe('readWorkerSetting', () => {
  it('uses registry defaults for a local gateway without config support', async () => {
    expect(await readWorkerSetting({}, 'dealer_enrich.max_per_run')).toBe(50)
  })
  it('uses the live gateway value for a worker job', async () => {
    const gateway = { getOperatorSetting: vi.fn(async () => 400) }
    expect(await readWorkerSetting(gateway, 'detail_crawl.batch_size')).toBe(400)
  })
})
