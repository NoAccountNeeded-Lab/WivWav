// @vitest-environment jsdom
//
// Regression coverage for #837: production web images never received a real
// NEXT_PUBLIC_API_URL at build time, so client-fetched widgets (this
// histogram, PriceHistogram, MileageHistogram, CategoryBarChart) silently
// fell back to a hardcoded localhost URL in the published image. The fix
// makes these components read the API host from the `data-api-url`
// attribute RootLayout stamps on `<body>` at request time (see
// `@/lib/api-url`'s `getClientApiBaseUrl`) instead of reading
// `process.env.NEXT_PUBLIC_API_URL` directly in a `'use client'` module.
//
// This test fails against the pre-fix implementation: setting `data-api-url`
// has no effect on `process.env.NEXT_PUBLIC_API_URL`, so the fetch would
// still target the localhost fallback even with a real host configured.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YearHistogram } from './YearHistogram'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/en/discover',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

describe('YearHistogram — runtime API base URL (#837)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Never resolves — these tests only inspect the request that was made,
    // not the render that follows a resolved fetch.
    fetchMock = vi.fn(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    document.body.removeAttribute('data-api-url')
  })

  it('fetches from the runtime API host injected via data-api-url, not a build-time default', async () => {
    document.body.dataset['apiUrl'] = 'https://api.wivwav.example'

    await act(async () => {
      render(<YearHistogram />)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const requestedUrl = String(fetchMock.mock.calls[0]?.[0])
    expect(requestedUrl.startsWith('https://api.wivwav.example/v1/listings/facets')).toBe(true)
  })

  it('falls back to the documented default when no runtime API host is injected', async () => {
    await act(async () => {
      render(<YearHistogram />)
    })

    const requestedUrl = String(fetchMock.mock.calls[0]?.[0])
    expect(requestedUrl.startsWith('http://localhost:4001/v1/listings/facets')).toBe(true)
  })
})
