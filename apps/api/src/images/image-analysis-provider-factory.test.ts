import { describe, it, expect } from 'vitest'
import { createImageAnalysisProvider, isImageAnalysisProviderName } from './image-analysis-provider-factory.js'

describe('createImageAnalysisProvider', () => {
  it('creates the noop provider', () => {
    expect(createImageAnalysisProvider('noop').name).toBe('noop')
  })

  it.each(['claude-cli', 'codex-cli'] as const)('creates %s and reports the model', (name) => {
    const provider = createImageAnalysisProvider(name, { model: 'm1' })
    expect(provider.name).toBe(name)
    expect(provider.model).toBe('m1')
  })

  it('reports no model when none is given', () => {
    expect(createImageAnalysisProvider('claude-cli').model).toBeNull()
  })
})

describe('isImageAnalysisProviderName', () => {
  it('accepts known names only', () => {
    expect(isImageAnalysisProviderName('codex-cli')).toBe(true)
    expect(isImageAnalysisProviderName('Codex-CLI')).toBe(false)
    expect(isImageAnalysisProviderName('banana')).toBe(false)
  })
})
