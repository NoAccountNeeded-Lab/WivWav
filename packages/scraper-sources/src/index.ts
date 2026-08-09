/**
 * Browser layer and Chromium source adapters, shared by apps/scraper (until
 * the #948 cutover) and the future apps/worker. This package must never
 * depend on @wivwav/db — workers hold no database access.
 *
 * The barrel deliberately excludes the browser module (so importing it never
 * loads Playwright — use '@wivwav/scraper-sources/browser/index.js', lazily
 * where that matters) and the per-source detail parsers (their exports
 * collide across modules — import them by subpath, e.g.
 * '@wivwav/scraper-sources/sources/blvd-detail.js').
 */
export * from './engine/source-adapter.js'
export * from './engine/listing-upsert.js'
export * from './sources/factory.js'
export * from './sources/adapters.js'
export * from './sources/field-transforms.js'
export * from './sources/image-filter.js'
export * from './jobs/job-progress.js'
export * from './util/jitter-sleep.js'
export * from './util/navigation-timeout.js'
export * from './util/robots-cache.js'
export * from './lib/parse-vehicle-title.js'
export * from './lib/sale-status.js'
