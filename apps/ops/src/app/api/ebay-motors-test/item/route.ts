import { type NextRequest, NextResponse } from 'next/server'
import { resolveEbayCredentials } from '@/lib/resolve-ebay-credentials'

const HOSTS = { production: 'api.ebay.com', sandbox: 'api.sandbox.ebay.com' } as const
const REQUEST_TIMEOUT_MS = 15_000

interface EbayItemDetail {
  itemId: string
  title: string
  itemWebUrl?: string
  itemLocation?: { city?: string; stateOrProvince?: string; postalCode?: string }
  localizedAspects?: { name: string; value: string }[]
}

async function getAccessToken(host: string, appId: string, certId: string): Promise<string> {
  const basic = Buffer.from(`${appId}:${certId}`).toString('base64')
  const res = await fetch(`https://${host}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string }
  return body.access_token
}

/**
 * `getItem` detail lookup for the eBay Motors keyword-tester (#999) — the
 * search endpoint carries no VIN, mileage, city/state, or private/dealer
 * signal (see packages/scraper-sources/src/sources/ebay-motors.ts); this
 * lets an operator pull up a single result's full `localizedAspects` to
 * judge whether a keyword surfaced a genuine, well-described WAV listing.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const itemId = req.nextUrl.searchParams.get('itemId')?.trim()
  if (!itemId) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'itemId is required' } }, { status: 400 })
  }

  const credentials = await resolveEbayCredentials()
  if (!credentials) {
    return NextResponse.json(
      { error: { code: 'NOT_CONFIGURED', message: 'eBay Motors credentials are not configured' } },
      { status: 404 },
    )
  }

  const host = HOSTS[credentials.environment]

  try {
    const token = await getAccessToken(host, credentials.appId, credentials.certId)
    const res = await fetch(`https://${host}/buy/browse/v1/item/${encodeURIComponent(itemId)}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: { code: 'EBAY_API_ERROR', message: `${res.status} ${await res.text()}` } },
        { status: res.status },
      )
    }

    const body = (await res.json()) as EbayItemDetail
    return NextResponse.json({
      data: {
        itemId: body.itemId,
        title: body.title,
        itemWebUrl: body.itemWebUrl ?? null,
        location:
          [body.itemLocation?.city, body.itemLocation?.stateOrProvince].filter(Boolean).join(', ') || null,
        aspects: body.localizedAspects ?? [],
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Unknown error' } },
      { status: 500 },
    )
  }
}
