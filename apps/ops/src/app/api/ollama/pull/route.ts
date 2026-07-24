import { type NextRequest, NextResponse } from 'next/server'
import { OLLAMA_DEFAULT_BASE_URL } from '@/lib/resolve-ollama-config'

// Large models can take a long time to download over a slow connection —
// generous but bounded so a stalled daemon doesn't hang the request forever.
const PULL_TIMEOUT_MS = 30 * 60_000

/**
 * Proxies `POST /api/pull` from the ops server to the connected Ollama
 * instance and streams the newline-delimited JSON progress body straight
 * through to the browser (#250). The browser never talks to Ollama directly —
 * same server-side-only pattern as `apps/ops/src/app/api/ai-test/*`.
 */
export async function POST(req: NextRequest): Promise<NextResponse | Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 },
    )
  }

  const name = (body as Record<string, unknown>)?.name
  if (typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'name is required' } },
      { status: 400 },
    )
  }

  const baseUrl = process.env.OLLAMA_BASE_URL ?? OLLAMA_DEFAULT_BASE_URL

  let ollamaRes: Response
  try {
    ollamaRes = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), stream: true }),
      signal: AbortSignal.timeout(PULL_TIMEOUT_MS),
    })
  } catch (e) {
    const cause = e instanceof Error ? (e as Error & { cause?: unknown }).cause : undefined
    const message = cause instanceof Error ? cause.message : (e instanceof Error ? e.message : 'Could not connect to Ollama')
    return NextResponse.json(
      { error: { code: 'OLLAMA_UNAVAILABLE', message } },
      { status: 503 },
    )
  }

  if (!ollamaRes.ok || !ollamaRes.body) {
    let message = `Ollama returned HTTP ${ollamaRes.status}`
    try {
      const errBody = await ollamaRes.json() as { error?: string }
      if (errBody.error) message = errBody.error
    } catch {
      // Ollama's error body isn't always JSON — fall back to the status message.
    }
    return NextResponse.json(
      { error: { code: 'OLLAMA_ERROR', message } },
      { status: ollamaRes.status || 502 },
    )
  }

  // Pass the NDJSON progress stream straight through unmodified — the client
  // parses each line as it arrives.
  return new Response(ollamaRes.body, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  })
}
