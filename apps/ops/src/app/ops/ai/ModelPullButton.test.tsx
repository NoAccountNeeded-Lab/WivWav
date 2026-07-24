// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelPullButton } from './ModelPullButton'

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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ModelPullButton', () => {
  it('streams progress, shows a percentage, and calls onInstalled on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([
      '{"status":"pulling manifest"}',
      '{"status":"pulling sha256:abc","digest":"sha256:abc","total":1000,"completed":500}',
      '{"status":"pulling sha256:abc","digest":"sha256:abc","total":1000,"completed":1000}',
      '{"status":"success"}',
    ])))

    const onInstalled = vi.fn()
    render(<ModelPullButton modelName="llama3.2" onInstalled={onInstalled} />)

    fireEvent.click(screen.getByRole('button', { name: 'Pull model llama3.2' }))

    await waitFor(() => {
      expect(screen.getByText('Installed ✓')).toBeDefined()
    })
    expect(onInstalled).toHaveBeenCalled()

    const fetchMock = vi.mocked(fetch)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/ollama/pull')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'llama3.2' })
  })

  it('shows an intermediate percentage on the progressbar while pulling', async () => {
    let resolveSecondChunk: (() => void) | undefined
    const gate = new Promise<void>(resolve => { resolveSecondChunk = resolve })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('{"status":"pulling sha256:abc","digest":"sha256:abc","total":1000,"completed":250}\n'))
          await gate
          controller.enqueue(encoder.encode('{"status":"success"}\n'))
          controller.close()
        },
      }),
      { status: 200 },
    )))

    render(<ModelPullButton modelName="llama3.2" onInstalled={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pull model llama3.2' }))

    const bar = await screen.findByRole('progressbar', { name: 'Download progress for llama3.2' })
    await waitFor(() => expect(bar.getAttribute('aria-valuenow')).toBe('25'))

    resolveSecondChunk?.()
  })

  it('shows a clear error message when the pull request fails outright', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'model "nope" not found' } }), { status: 404 }),
    ))

    render(<ModelPullButton modelName="nope" onInstalled={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pull model nope' }))

    await waitFor(() => {
      expect(screen.getByText('model "nope" not found')).toBeDefined()
    })
  })

  it('shows a clear error message when Ollama is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Could not connect to Ollama')))

    render(<ModelPullButton modelName="llama3.2" onInstalled={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pull model llama3.2' }))

    await waitFor(() => {
      expect(screen.getByText('Could not connect to Ollama')).toBeDefined()
    })
  })
})
