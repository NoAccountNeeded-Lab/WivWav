import { type NextRequest, NextResponse } from 'next/server'
import { resolveEbayCredentials } from '@/lib/resolve-ebay-credentials'

const HOSTS = { production: 'api.ebay.com', sandbox: 'api.sandbox.ebay.com' } as const
const REQUEST_TIMEOUT_MS = 15_000
const MAX_LIMIT = 50

interface EbaySearchItem {
  itemId: string
  title: string
  price?: { value: string; currency: string }
  condition?: string
  itemWebUrl?: string
  categories?: { categoryId: string; categoryName: string }[]
  image?: { imageUrl: string }
  itemLocation?: { city?: string; stateOrProvince?: string; postalCode?: string; country?: string }
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
 * Keyword-tuning tool for the eBay Motors source (#999) — lets an operator
 * try different `q`/`category_ids` values against the real Browse API
 * search endpoint and see what comes back, without touching the production
 * ingestion adapter's keyword list. Read-only; does not write to the
 * database or affect any scheduled scrape.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'q is required' } }, { status: 400 })
  }
  const categoryIds = req.nextUrl.searchParams.get('categoryIds')?.trim() || '6001'
  const limitParam = Number.parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10)
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 20, 1), MAX_LIMIT)

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
    const params = new URLSearchParams({ q, category_ids: categoryIds, limit: String(limit) })
    const res = await fetch(`https://${host}/buy/browse/v1/item_summary/search?${params}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: { code: 'EBAY_API_ERROR', message: `${res.status} ${await res.text()}` } },
        { status: res.status },
      )
    }

    const body = (await res.json()) as { total?: number; itemSummaries?: EbaySearchItem[] }
    const items = (body.itemSummaries ?? []).map((item) => ({
      itemId: item.itemId,
      title: item.title,
      price: item.price?.value ? `${item.price.value} ${item.price.currency}` : null,
      condition: item.condition ?? null,
      itemWebUrl: item.itemWebUrl ?? null,
      categoryPath: (item.categories ?? []).map((c) => c.categoryName).join(' > ') || null,
      imageUrl: item.image?.imageUrl ?? null,
      location:
        [item.itemLocation?.city, item.itemLocation?.stateOrProvince].filter(Boolean).join(', ') || null,
    }))

    return NextResponse.json({ data: { total: body.total ?? 0, environment: credentials.environment, items } })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Unknown error' } },
      { status: 500 },
    )
  }
}
