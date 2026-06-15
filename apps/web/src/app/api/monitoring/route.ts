import { type NextRequest, NextResponse } from 'next/server'

const REGION_ALLOWLIST = new Set(['us', 'de'])
const ORG_ID_PATTERN = /^\d+$/
const PROJECT_ID_PATTERN = /^\d+$/
const MAX_BODY_BYTES = 512 * 1024

// Parse the configured DSN once at module load so every request can validate
// that the tunnelled org ID matches the project this server is configured for.
const SENTRY_ORG_ID = (() => {
  const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN']
  if (!dsn) return null
  const match = dsn.match(/@o(\d+)\./)
  return match?.[1] ?? null
})()

function buildEnvelopeUrl(searchParams: URLSearchParams): string | null {
  const orgId = searchParams.get('o')
  const projectId = searchParams.get('p')
  const region = searchParams.get('r')

  if (SENTRY_ORG_ID === null) return null
  if (!orgId || !ORG_ID_PATTERN.test(orgId)) return null
  if (orgId !== SENTRY_ORG_ID) return null
  if (!projectId || !PROJECT_ID_PATTERN.test(projectId)) return null
  if (region !== null && !REGION_ALLOWLIST.has(region)) return null

  const host = region ? `o${orgId}.ingest.${region}.sentry.io` : `o${orgId}.ingest.sentry.io`
  return `https://${host}/api/${projectId}/envelope/?hsts=0`
}

export async function POST(req: NextRequest): Promise<Response> {
  if (process.env['SENTRY_ENABLED'] !== 'true') {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Monitoring tunnel is disabled' } },
      { status: 404 },
    )
  }

  const envelopeUrl = buildEnvelopeUrl(req.nextUrl.searchParams)
  if (!envelopeUrl) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid Sentry tunnel parameters' } },
      { status: 400 },
    )
  }

  const contentLength = req.headers.get('content-length')
  if (contentLength !== null && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Envelope exceeds 512 KB' } },
      { status: 413 },
    )
  }

  const body = await req.text()
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Envelope exceeds 512 KB' } },
      { status: 413 },
    )
  }

  let upstream: globalThis.Response
  try {
    upstream = await fetch(envelopeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': req.headers.get('content-type') ?? 'application/x-sentry-envelope',
      },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_GATEWAY', message: 'Sentry ingest unreachable' } },
      { status: 502 },
    )
  }

  const retryAfter = upstream.headers.get('Retry-After')
  const rateLimitHeader = upstream.headers.get('X-Sentry-Rate-Limit')
  const headers: Record<string, string> = {}
  if (retryAfter) headers['Retry-After'] = retryAfter
  if (rateLimitHeader) headers['X-Sentry-Rate-Limit'] = rateLimitHeader
  return new Response(upstream.body, { status: upstream.status, headers })
}
