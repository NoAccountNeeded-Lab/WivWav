import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Characterization of the built-in transport (defaultFetchPage), exercised via
// the public adapter entry point with node:https mocked (no live network).
const requestMock = vi.hoisted(() => vi.fn())
vi.mock('node:https', () => ({ request: requestMock }))

import { MobilityVanSalesAdapter } from './mobility-van-sales.js'

type Reply = { status: number; body?: string; location?: string } | { error: Error }

function queue(...replies: Reply[]): void {
  for (const reply of replies) {
    requestMock.mockImplementationOnce((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
      const req = Object.assign(new EventEmitter(), {
        setTimeout: vi.fn(),
        destroy: vi.fn(),
        end: () => {
          if ('error' in reply) {
            req.emit('error', reply.error)
            return
          }
          const res = Object.assign(new EventEmitter(), {
            statusCode: reply.status,
            headers: reply.location ? { location: reply.location } : {},
          })
          cb(res)
          if (reply.body) res.emit('data', Buffer.from(reply.body))
          res.emit('end')
        },
      })
      return req
    })
  }
}

const adapter = () => new MobilityVanSalesAdapter(null)

describe('MobilityVanSales default transport', () => {
  beforeEach(() => requestMock.mockReset())

  it('fetches over https with TLS validation bypassed for the origin host and a fresh agent', async () => {
    queue({ status: 200, body: '' })
    await adapter().checkPage1()
    const [url, opts] = requestMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(url).toBe('https://www.mobilityvansales.com/used-handicap-vans/usa-handicap-vansales.html')
    expect(opts).toMatchObject({ method: 'GET', agent: false, rejectUnauthorized: false })
    expect(opts['headers']).toEqual({ 'User-Agent': 'WivWav/1.0 (wivwav.com)' })
  })

  it('follows a same-host redirect', async () => {
    queue({ status: 301, location: '/moved.html' }, { status: 200, body: '' })
    await adapter().checkPage1()
    expect(requestMock).toHaveBeenCalledTimes(2)
    expect((requestMock.mock.calls[1] as [string])[0]).toBe('https://www.mobilityvansales.com/moved.html')
  })

  it('refuses a cross-host redirect without retrying', async () => {
    queue({ status: 302, location: 'https://evil.example/x' })
    await expect(adapter().checkPage1()).rejects.toThrow(/Refusing cross-host redirect/)
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('stops after too many redirects', async () => {
    for (let i = 0; i < 6; i++) queue({ status: 302, location: '/loop.html' })
    await expect(adapter().checkPage1()).rejects.toThrow(/Too many redirects/)
    expect(requestMock).toHaveBeenCalledTimes(6)
  })

  it('retries a dropped connection and then succeeds', async () => {
    queue({ error: new Error('socket hang up') }, { status: 200, body: '' })
    await expect(adapter().checkPage1()).resolves.toMatchObject({ changed: true })
    expect(requestMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after three attempts on a persistent transient error', async () => {
    queue(...Array.from({ length: 3 }, () => ({ error: new Error('socket hang up') })))
    await expect(adapter().checkPage1()).rejects.toThrow(/socket hang up/)
    expect(requestMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry a non-transient error', async () => {
    queue({ error: new Error('boom') })
    await expect(adapter().checkPage1()).rejects.toThrow(/boom/)
    expect(requestMock).toHaveBeenCalledTimes(1)
  })
})
