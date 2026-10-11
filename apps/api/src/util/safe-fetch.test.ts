import { beforeEach, describe, expect, it, vi } from 'vitest'

const lookupMock = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))

import { safeFetch } from './safe-fetch.js'

const fetchMock = vi.fn()
const ok = () => new Response('x', { status: 200, headers: { 'content-type': 'image/png' } })
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } })
const opts = { retries: 0 }

beforeEach(() => {
  fetchMock.mockReset()
  lookupMock.mockReset()
  lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  vi.stubGlobal('fetch', fetchMock)
})

describe('safeFetch', () => {
  it('fetches a public https URL', async () => {
    fetchMock.mockResolvedValue(ok())
    const res = await safeFetch('https://img.example.com/a.png', undefined, opts)
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
  })

  it.each([
    'http://img.example.com/a.png',
    'javascript:alert(1)',
    'https://127.0.0.1/a.png',
    'https://10.1.2.3/a.png',
    'https://192.168.1.1/a.png',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/a.png',
    'https://[fd00::1]/a.png',
    'https://[::ffff:127.0.0.1]/a.png',
    'https://100.64.0.1/a.png',
  ])('rejects %s without fetching', async (url) => {
    await expect(safeFetch(url, undefined, opts)).rejects.toThrow(/blocked URL/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a hostname that resolves to a private address (any of several)', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ])
    await expect(safeFetch('https://evil.example.com/a.png', undefined, opts)).rejects.toThrow(/blocked URL/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['http://example.com/x', 'https://169.254.169.254/x', 'https://[::1]/x', 'https://[fd00::2]/x'])(
    'rejects a public host redirecting to %s',
    async (target) => {
      fetchMock.mockResolvedValueOnce(redirect(target))
      await expect(safeFetch('https://img.example.com/a.png', undefined, opts)).rejects.toThrow(/blocked URL/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('follows a safe redirect and caps hops', async () => {
    fetchMock.mockResolvedValueOnce(redirect('/b.png')).mockResolvedValueOnce(ok())
    expect((await safeFetch('https://img.example.com/a.png', undefined, opts)).status).toBe(200)

    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => redirect('/loop'))
    await expect(safeFetch('https://img.example.com/a.png', undefined, opts)).rejects.toThrow(/too many redirects/)
  })
})
