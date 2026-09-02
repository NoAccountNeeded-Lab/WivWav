import type { SourceAdapterModule } from './factory.js'
import * as amsVansClassifieds from './ams-vans-classifieds.js'
import * as blvd from './blvd.js'
import * as freedomMotors from './freedom-motors.js'
import * as mobilityworks from './mobilityworks.js'
import * as superiorVan from './superior-van.js'

/**
 * Static adapter-module map keyed by `ScraperSourceRegistryEntry.key`
 * (@wivwav/types source-registry). Replaces apps/scraper's former
 * `import(`./${key}.js`)` — a relative dynamic import cannot cross the
 * package boundary, and the static map is bundler-friendly (#950).
 */
export const SOURCE_ADAPTER_MODULES: Readonly<Record<string, SourceAdapterModule>> = {
  'ams-vans-classifieds': amsVansClassifieds,
  blvd,
  'freedom-motors': freedomMotors,
  mobilityworks,
  'superior-van': superiorVan,
}
