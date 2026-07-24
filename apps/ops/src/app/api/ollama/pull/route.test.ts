import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ollama/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeBadRequest(): NextRequest {
  return new NextRequest('http://localhost/api/ollama/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json{{{',
  })
}

function ndjsonResponse(lines: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })
}

describe('POST /api/ollama/pull', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 400 for invalid JSON body', async () => {
    const res = await POST(makeBadRequest())
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('returns 400 when name is missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.message).toMatch(/name/i)
  })

  it('returns 400 when name is whitespace-only', async () => {
    const res = await POST(makeRequest({ name: '   ' }))
    expect(res.status).toBe(400)
  })

  it('returns 503 when Ollama is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')))

    const res = await POST(makeRequest({ name: 'llama3.2' }))
    expect(res.status).toBe(503)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('OLLAMA_UNAVAILABLE')
  })

  it('returns the Ollama error body and status when the pull request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'model "nope" not found' }), { status: 404 }),
    ))

    const res = await POST(makeRequest({ name: 'nope' }))
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('OLLAMA_ERROR')
    expect(body.error.message).toBe('model "nope" not found')
  })

  it('streams the NDJSON progress body through on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      ndjsonResponse(['{"status":"pulling manifest"}', '{"status":"success"}']),
    ))

    const res = await POST(makeRequest({ name: 'llama3.2' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/x-ndjson')
    const text = await res.text()
    expect(text).toBe('{"status":"pulling manifest"}\n{"status":"success"}\n')
  })

  it('sends the trimmed model name and stream:true to Ollama', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ndjsonResponse(['{"status":"success"}']))
    vi.stubGlobal('fetch', fetchMock)

    await POST(makeRequest({ name: '  llama3.2  ' }))

    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toContain('/api/pull')
    const sentBody = JSON.parse(call[1].body as string) as { name: string; stream: boolean }
    expect(sentBody).toEqual({ name: 'llama3.2', stream: true })
  })
})
