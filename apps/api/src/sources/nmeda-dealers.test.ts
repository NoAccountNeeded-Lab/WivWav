import { beforeEach, describe, expect, it, vi } from 'vitest'

const findFirst = vi.fn()
const update = vi.fn()
const create = vi.fn()
const report = vi.fn()

vi.mock('@wivwav/db', () => ({ getDb: () => ({ nmeaDealer: { findFirst, update, create } }) }))
vi.mock('../jobs/job-progress.js', () => ({ report: (...args: unknown[]) => report(...args) }))
vi.mock('../seeds/nmeda-dealers.json', () => ({
  default: [
    { name: 'Existing Dealer', address: '1 Main', state: 'CO', zip: '80000', phone: null, website: null, qapCertified: true },
    { name: 'New Dealer', address: null, state: null, zip: null, phone: '555', website: 'https://n', qapCertified: false },
  ],
}))

import { runNmedaDealersSeedJob } from './nmeda-dealers.js'

describe('runNmedaDealersSeedJob', () => {
  beforeEach(() => {
    findFirst.mockReset()
    update.mockReset()
    create.mockReset()
    report.mockReset()
  })

  it('updates existing dealers by name and creates missing ones', async () => {
    findFirst.mockResolvedValueOnce({ id: 'd1' }).mockResolvedValueOnce(null)
    await runNmedaDealersSeedJob()

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { address: '1 Main', state: 'CO', zip: '80000', phone: null, website: null, qapCertified: true },
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[0].data).toMatchObject({ name: 'New Dealer', phone: '555', qapCertified: false })
  })

  it('reports start, per-dealer, and completion progress', async () => {
    findFirst.mockResolvedValue(null)
    const context = { log: vi.fn() } as never
    await runNmedaDealersSeedJob(context)

    const messages = report.mock.calls.map((c) => c[1] as string)
    expect(messages[0]).toContain('Upserting 2 dealer record(s)')
    expect(messages).toContain('[nmeda-dealers] 2/2 — New Dealer')
    expect(messages.at(-1)).toBe('[nmeda-dealers] Done. 2 dealer(s) upserted.')
    expect(report.mock.calls.at(-1)?.[2]).toEqual({ stage: 'complete', current: 2, total: 2 })
    expect(report.mock.calls[0]?.[0]).toBe(context)
  })
})
