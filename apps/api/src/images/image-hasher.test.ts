import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { computeDHash, hammingDistance, hashImage, MAX_IMAGE_BYTES, PHASH_NEAR_DUPLICATE_THRESHOLD } from './image-hasher.js'

// ── hammingDistance unit tests ───────────────────────────────────────────────

describe('hammingDistance', () => {
  it('should return 0 for identical hashes', () => {
    expect(hammingDistance('0000000000000000', '0000000000000000')).toBe(0)
  })

  it('should return 64 for completely inverted hashes', () => {
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64)
  })

  it('should return 1 for a single-bit difference', () => {
    expect(hammingDistance('0000000000000001', '0000000000000000')).toBe(1)
  })

  it('should be symmetric', () => {
    const a = 'abcdef0123456789'
    const b = '0123456789abcdef'
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a))
  })

  it('should throw for non-16-char inputs', () => {
    expect(() => hammingDistance('abc', '0000000000000000')).toThrow()
  })
})

// ── computeDHash (requires sharp — mock it for unit tests) ───────────────────

vi.mock('sharp', () => {
  const mockSharp = vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    greyscale: vi.fn().mockReturnThis(),
    raw: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(
      // 9x8 = 72 bytes. Each row is strictly decreasing (200,199,...,192) so
      // every adjacent pair has left > right → all 64 comparison bits = 1.
      // Pattern resets per row using (i % 9): 200 - (i % 9).
      // 8 rows of all-1s → pHash = 0xffffffffffffffff.
      Buffer.from(Array.from({ length: 72 }, (_, i) => 200 - (i % 9))),
    ),
  }))
  return { default: mockSharp }
})

describe('computeDHash', () => {
  it('should return a 16-char hex string', async () => {
    const result = await computeDHash(Buffer.from('fake image data'))
    expect(result).toHaveLength(16)
    expect(/^[0-9a-f]{16}$/.test(result)).toBe(true)
  })

  it('should return ffffffffffffffff when all left pixels > right pixels', async () => {
    const result = await computeDHash(Buffer.from('fake image data'))
    expect(result).toBe('ffffffffffffffff')
  })
})

// ── hashImage integration-style tests (mock fetch) ──────────────────────────

describe('hashImage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeFakeImageResponse(bytes: Buffer, contentType = 'image/jpeg'): Response {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes))
        controller.close()
      },
    })
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': contentType }),
      body,
    } as unknown as Response
  }

  it('should return ok with exact hash and pHash on a valid image response', async () => {
    const imageBytes = Buffer.from('fake PNG bytes for testing')
    const expectedSha = createHash('sha256').update(imageBytes).digest('hex')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFakeImageResponse(imageBytes)))

    const result = await hashImage('https://cdn.example.com/vehicle.jpg', { retries: 0 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.exactHash).toBe(expectedSha)
      expect(result.pHash).toHaveLength(16)
      expect(result.contentType).toBe('image/jpeg')
      expect(result.byteSize).toBe(imageBytes.length)
    }
  })

  it('should return bad_content_type when response is not an image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        body: new ReadableStream({ start(c) { c.close() } }),
      }),
    )

    const result = await hashImage('https://example.com/page.html', { retries: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('bad_content_type')
    }
  })

  it('should return too_large when response exceeds maxBytes', async () => {
    const bigBytes = Buffer.alloc(100)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFakeImageResponse(bigBytes)))

    const result = await hashImage('https://cdn.example.com/huge.jpg', {
      maxBytes: 10,
      retries: 0,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('too_large')
    }
  })

  it('should return fetch_error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const result = await hashImage('https://cdn.example.com/img.jpg', { retries: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('fetch_error')
    }
  })

  it('should return timeout on abort', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
    )

    const result = await hashImage('https://cdn.example.com/img.jpg', {
      retries: 0,
      timeoutMs: 1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('timeout')
    }
  })
})

// ── Constants ────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('MAX_IMAGE_BYTES should be 10 MiB', () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024)
  })

  it('PHASH_NEAR_DUPLICATE_THRESHOLD should be a positive integer', () => {
    expect(PHASH_NEAR_DUPLICATE_THRESHOLD).toBeGreaterThan(0)
    expect(Number.isInteger(PHASH_NEAR_DUPLICATE_THRESHOLD)).toBe(true)
  })
})
