import type { BrowserService } from '../browser/index.js'
import type { SourceAdapter } from '../engine/source-adapter.js'

export interface SourceAdapterFactoryConfig {
  previousPage1Hash?: string | null
  browserService?: BrowserService
}

export interface SourceAdapterModule {
  createSourceAdapter(
    previousHash: string | null,
    config: SourceAdapterFactoryConfig,
  ): SourceAdapter
}
