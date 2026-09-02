export type ScraperPipelineKind = 'scrape-only' | 'detail-pages'

export interface ScraperSourceRegistryEntry {
  key: string
  schedulerKey?: string
  name: string
  baseUrl: string
  cronExpression: string
  timezone: string
  pipeline: ScraperPipelineKind
}

export const SCRAPER_SOURCE_REGISTRY: readonly ScraperSourceRegistryEntry[] = [
  {
    key: 'blvd',
    name: 'BLVD.com',
    baseUrl: 'https://www.blvd.com',
    cronExpression: '0 */6 * * *',
    timezone: 'America/New_York',
    pipeline: 'detail-pages',
  },
  {
    key: 'mobilityworks',
    schedulerKey: 'mw',
    name: 'MobilityWorks',
    baseUrl: 'https://www.mobilityworks.com',
    cronExpression: '0 */8 * * *',
    timezone: 'America/New_York',
    pipeline: 'detail-pages',
  },
  {
    key: 'freedom-motors',
    name: 'Freedom Motors',
    baseUrl: 'https://www.freedommotors.com',
    cronExpression: '0 */12 * * *',
    timezone: 'America/New_York',
    // Detail extraction is declarative, driven by Source.mappings — see
    // packages/scraper-sources/src/sources/declarative-detail.ts and
    // freedom-motors-detail-mappings.ts (#822).
    pipeline: 'detail-pages',
  },
  {
    key: 'superior-van',
    name: 'Superior Van & Mobility',
    baseUrl: 'https://superiorvan.com',
    cronExpression: '0 */12 * * *',
    timezone: 'America/New_York',
    // Detail extraction is declarative, driven by Source.mappings — see
    // packages/scraper-sources/src/sources/declarative-detail.ts and
    // superior-van-detail-mappings.ts (#822 applied to a second site by #823).
    pipeline: 'detail-pages',
  },
  {
    key: 'ams-vans-classifieds',
    name: 'AMS Vans Mobility Classifieds',
    baseUrl: 'https://www.amsvans.com',
    cronExpression: '0 */12 * * *',
    timezone: 'America/New_York',
    // 'scrape-only' (not 'detail-pages'): each classified ad's full record is
    // already embedded server-side on its own detail page, so scrape() reads
    // it directly (via https://www.amsvans.com/sitemap.xml for discovery)
    // instead of needing a separate list/detail-crawl split (#998).
    pipeline: 'scrape-only',
  },
] as const

export function findScraperSourceByName(name: string): ScraperSourceRegistryEntry | undefined {
  return SCRAPER_SOURCE_REGISTRY.find((entry) => entry.name === name)
}
