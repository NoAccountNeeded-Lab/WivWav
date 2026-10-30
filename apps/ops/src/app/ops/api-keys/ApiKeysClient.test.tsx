// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiKeysClient } from './ApiKeysClient'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function listResponse(keys: unknown[], total = keys.length): Response {
  return jsonResponse({ data: { keys, pagination: { limit: 50, offset: 0, total } } })
}

const activeKey = {
  id: 'key-1', ownerEmail: 'buyer@example.com', tier: 'PRO', rateLimitRpm: 600,
  createdAt: '2026-07-14T00:00:00.000Z', revokedAt: null,
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ApiKeysClient (#1203)', () => {
  it('creates a key, displays its one-time value, and clears it on request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') return jsonResponse({ data: { rawKey: 'wav_one_time_value' } }, 201)
      if (url.endsWith('/internal/ops/api-keys?limit=50&offset=0')) return listResponse([activeKey])
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ApiKeysClient apiBaseUrl="/ops/api" />)
    await screen.findByText('buyer@example.com')

    fireEvent.change(screen.getByLabelText('Owner email'), { target: { value: 'buyer@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /create api key/i }))

    expect(await screen.findByText('wav_one_time_value')).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/ops/api/internal/ops/api-keys', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ ownerEmail: 'buyer@example.com', tier: 'FREE' }),
    }))
    expect(screen.getByRole('button', { name: /create api key/i }).hasAttribute('disabled')).toBe(true)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /clear key/i }))
    await waitFor(() => expect(screen.queryByText('wav_one_time_value')).toBeNull())
  })

  it('requires confirmation before revoking and updates the listed status', async () => {
    let revoked = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'DELETE') {
        revoked = true
        return jsonResponse({ data: { id: 'key-1', revoked: true } })
      }
      if (url.endsWith('/internal/ops/api-keys?limit=50&offset=0')) {
        return listResponse([{ ...activeKey, revokedAt: revoked ? '2026-07-15T00:00:00.000Z' : null }])
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ApiKeysClient apiBaseUrl="/ops/api" />)
    await screen.findByText('buyer@example.com')
    fireEvent.click(screen.getByRole('button', { name: /revoke key/i }))

    expect(screen.getByText(/revoke this key/i)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /confirm revoke/i }))

    expect(await screen.findByText('Revoked')).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/ops/api/internal/ops/api-keys/key-1', { method: 'DELETE' })
  })

  it('shows API errors without hiding the issued keys list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'API unavailable' } }, 503)))

    render(<ApiKeysClient apiBaseUrl="/ops/api" />)

    expect(await screen.findByText('API keys could not load: API unavailable')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'API keys' })).not.toBeNull()
  })
})
