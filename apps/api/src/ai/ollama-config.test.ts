import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveOllamaModel } from './ollama-config.js'

describe('resolveOllamaModel', () => {
  let mockDb: { configEntry: { findFirst: ReturnType<typeof vi.fn> } }

  beforeEach(() => {
    mockDb = {
      configEntry: {
        findFirst: vi.fn(),
      },
    }
  })

  it('returns ai.scraper.remap.model when configured', async () => {
    vi.mocked(mockDb.configEntry.findFirst)
      .mockResolvedValueOnce({ key: 'ai.scraper.remap.model', value: 'qwen2.5-coder:7b' })

    const model = await resolveOllamaModel(mockDb as never)
    expect(model).toBe('qwen2.5-coder:7b')
    expect(mockDb.configEntry.findFirst).toHaveBeenCalledWith({ where: { key: 'ai.scraper.remap.model' }, orderBy: { createdAt: 'desc' } })
  })

  it('falls back to ai.scraper.structure.model when remap model is absent', async () => {
    vi.mocked(mockDb.configEntry.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ key: 'ai.scraper.structure.model', value: 'llama3.2:3b' })

    const model = await resolveOllamaModel(mockDb as never)
    expect(model).toBe('llama3.2:3b')
    expect(mockDb.configEntry.findFirst).toHaveBeenNthCalledWith(1, { where: { key: 'ai.scraper.remap.model' }, orderBy: { createdAt: 'desc' } })
    expect(mockDb.configEntry.findFirst).toHaveBeenNthCalledWith(2, { where: { key: 'ai.scraper.structure.model' }, orderBy: { createdAt: 'desc' } })
  })

  it('returns null when no scraper model config is available', async () => {
    vi.mocked(mockDb.configEntry.findFirst).mockResolvedValue(null)

    const model = await resolveOllamaModel(mockDb as never)
    expect(model).toBeNull()
  })
})
