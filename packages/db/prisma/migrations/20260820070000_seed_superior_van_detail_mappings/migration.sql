-- Seed the Superior Van & Mobility source's declarative detail-page field
-- mappings (#822's extractor applied to a second source by #823): flipping
-- its pipeline to 'detail-pages' (packages/types/src/source-registry.ts)
-- makes detail-extract.ts read Source.mappings at extraction time via the
-- generic declarative extractor (apps/scraper/src/sources/declarative-
-- detail.ts), but that only helps if the row actually has mappings.
--
-- registry.ts's registerSources() seeds this same value on a brand-new
-- install (create-only, via DEFAULT_MAPPINGS_BY_KEY), but that path never
-- touches an already-existing row (`update: {}`). This migration backfills
-- the row that already exists in any deployment where Superior Van was
-- previously scrape-only.
--
-- Guarded on mappings = '[]'::jsonb so this never overwrites a mappings row
-- that has since been customized by an operator or the AI structure-remap
-- loop (scraper-engine.ts's setMappings) — an idle/never-remapped scrape-only
-- source always has the schema default of '[]'.
--
-- Selector values must stay in sync with the canonical TypeScript source of
-- truth: apps/scraper/src/sources/superior-van-detail-mappings.ts.
UPDATE "sources"
SET "mappings" = '[
  {"targetField": "images", "selector": ".vehicle-gallery .vehicle-gallery-item img", "attribute": "src", "transform": null},
  {"targetField": "color", "selector": "//span[contains(@class,\"elementor-icon-list-text\")][b[contains(text(),\"Exterior Color\")]]", "attribute": null, "transform": "afterColon"},
  {"targetField": "fuelType", "selector": "//span[contains(@class,\"elementor-icon-list-text\")][b[contains(text(),\"Fuel Type\")]]", "attribute": null, "transform": "afterColon"}
]'::jsonb
WHERE "name" = 'Superior Van & Mobility'
  AND "mappings" = '[]'::jsonb;
