'use client'
import { PriceHistogram } from '@wivwav/web'

// PriceHistogram has no data prop — it always fetches from
// `${NEXT_PUBLIC_API_URL}/v1/listings/facets` in a useEffect. To render a
// static, realistic preview we patch window.fetch to answer that endpoint
// with canned listings-facets data (both price and year distributions, so
// this mock is safe to share with the YearHistogram preview too).
const priceDistribution = [
  { bucket: '0-5000', count: 2 },
  { bucket: '5000-10000', count: 6 },
  { bucket: '10000-15000', count: 13 },
  { bucket: '15000-20000', count: 21 },
  { bucket: '20000-25000', count: 34 },
  { bucket: '25000-30000', count: 29 },
  { bucket: '30000-35000', count: 18 },
  { bucket: '35000-40000', count: 11 },
  { bucket: '40000-45000', count: 6 },
  { bucket: '45000-50000', count: 3 },
]

const yearDistribution = [
  { year: 2015, count: 4 },
  { year: 2017, count: 9 },
  { year: 2019, count: 18 },
  { year: 2021, count: 27 },
  { year: 2023, count: 22 },
  { year: 2025, count: 10 },
]

function installMock() {
  if (typeof window === 'undefined') return
  const w = window as unknown as { fetch: typeof fetch & { __wivwavMocked?: boolean } }
  if (w.fetch.__wivwavMocked) return
  const original = w.fetch.bind(window)
  const mocked = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('/v1/listings/facets')) {
      return new Response(
        JSON.stringify({ data: { priceDistribution, yearDistribution, total: 143 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return original(input, init)
  }) as typeof fetch & { __wivwavMocked?: boolean }
  mocked.__wivwavMocked = true
  w.fetch = mocked
}

installMock()

export function Default() {
  return (
    <div style={{ width: 420 }}>
      <PriceHistogram />
    </div>
  )
}
