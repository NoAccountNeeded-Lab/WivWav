import { describe, it, expect, vi } from 'vitest'

vi.mock('sharp', () => {
  throw new Error('Unsupported CPU: Prebuilt binaries for Linux x64 require v2 microarchitecture')
})

describe('sharp unavailable', () => {
  it('importing the hasher and CLI provider does not throw', async () => {
    await expect(import('./image-hasher.js')).resolves.toBeDefined()
    await expect(import('./cli-image-analysis-provider.js')).resolves.toBeDefined()
  })

  it('computeDHash rejects with an error naming sharp', async () => {
    const { computeDHash } = await import('./image-hasher.js')
    await expect(computeDHash(Buffer.from('x'))).rejects.toThrow(/sharp is unavailable/)
  })

  it('shrinkForModel returns the original bytes', async () => {
    const { shrinkForModel } = await import('./cli-image-analysis-provider.js')
    const bytes = new Uint8Array([1, 2, 3])
    await expect(shrinkForModel(bytes, 'image/jpeg', 100)).resolves.toEqual({ bytes, contentType: 'image/jpeg' })
  })
})
