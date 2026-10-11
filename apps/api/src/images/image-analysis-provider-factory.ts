import { NoopImageAnalysisProvider } from './image-analysis-provider.js'
import type { ImageAnalysisProvider } from './image-analysis-provider.js'
import { CliImageAnalysisProvider } from './cli-image-analysis-provider.js'

export const IMAGE_ANALYSIS_PROVIDER_NAMES = ['noop', 'claude-cli', 'codex-cli'] as const
export type ImageAnalysisProviderName = (typeof IMAGE_ANALYSIS_PROVIDER_NAMES)[number]

export function isImageAnalysisProviderName(value: string): value is ImageAnalysisProviderName {
  return (IMAGE_ANALYSIS_PROVIDER_NAMES as readonly string[]).includes(value)
}

/**
 * Selects a provider by name so further methods (hosted API, free-tier API,
 * Ollama) can be added here without touching callers (#1112).
 */
export function createImageAnalysisProvider(
  name: ImageAnalysisProviderName,
  options: { model?: string; timeoutMs?: number; maxImageEdgePx?: number } = {},
): ImageAnalysisProvider {
  switch (name) {
    case 'noop':
      return new NoopImageAnalysisProvider()
    case 'claude-cli':
    case 'codex-cli':
      return new CliImageAnalysisProvider({ kind: name, ...options })
  }
}
