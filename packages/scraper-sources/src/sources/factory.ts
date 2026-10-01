import type { BrowserService } from '../browser/index.js'
import type { SourceAdapter } from '../engine/source-adapter.js'

export interface SourceAdapterFactoryConfig {
  previousPage1Hash?: string | null
  browserService?: BrowserService
  /**
   * eBay Developer Program credentials for the Browse API (#999). Resolved
   * from `ConfigService` by the caller (apps/worker's source-scrape handler,
   * via the gateway) and injected here rather than read directly by the
   * adapter — packages/scraper-sources must not depend on apps/api's
   * ConfigService/Prisma client.
   */
  ebayCredentials?: EbayCredentials
}

export interface EbayCredentials {
  appId: string
  certId: string
  /** Picks the `api.ebay.com` vs `api.sandbox.ebay.com` host. Never inferred from key naming. */
  environment: 'production' | 'sandbox'
}

export interface SourceAdapterModule {
  createSourceAdapter(
    previousHash: string | null,
    config: SourceAdapterFactoryConfig,
  ): SourceAdapter
}
