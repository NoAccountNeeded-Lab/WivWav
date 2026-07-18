-- Seed the Freedom Motors source's declarative detail-page field mappings
-- (#822): flipping its pipeline to 'detail-pages' (packages/types/src/
-- source-registry.ts) makes detail-extract.ts read Source.mappings at
-- extraction time via the generic declarative extractor
-- (apps/scraper/src/sources/declarative-detail.ts), but that only helps if
-- the row actually has mappings.
--
-- registry.ts's registerSources() seeds this same value on a brand-new
-- install (create-only, via DEFAULT_MAPPINGS_BY_KEY), but that path never
-- touches an already-existing row (`update: {}`). This migration backfills
-- the row that already exists in any deployment where Freedom Motors was
-- previously scrape-only.
--
-- Guarded on mappings = '[]'::jsonb so this never overwrites a mappings row
-- that has since been customized by an operator or the AI structure-remap
-- loop (scraper-engine.ts's setMappings) — an idle/never-remapped scrape-only
-- source always has the schema default of '[]'.
--
-- Selector values must stay in sync with the canonical TypeScript source of
-- truth: apps/scraper/src/sources/freedom-motors-detail-mappings.ts.
UPDATE "sources"
SET "mappings" = '[
  {"targetField": "images", "selector": ".images .woocommerce-product-gallery__image img.wp-post-image", "attribute": "data-large_image", "transform": null},
  {"targetField": "color", "selector": "//li[contains(@class,\"product_attribute-row\")][b[contains(text(),\"Exterior Color\")]]/span", "attribute": null, "transform": "trimText"},
  {"targetField": "fuelType", "selector": "//li[contains(@class,\"product_attribute-row\")][b[contains(text(),\"Fuel Type\")]]/span", "attribute": null, "transform": "trimText"},
  {"targetField": "engine", "selector": "//li[contains(@class,\"product_attribute-row\")][b[contains(text(),\"Engine\")]]/span", "attribute": null, "transform": "trimText"},
  {"targetField": "transmission", "selector": "//li[contains(@class,\"product_attribute-row\")][b[contains(text(),\"Trans\")]]/span", "attribute": null, "transform": "trimText"},
  {"targetField": "conversionType", "selector": "//li[contains(@class,\"product_attribute-row\")][b[contains(text(),\"Conversion Location\")]]/span", "attribute": null, "transform": "trimText"},
  {"targetField": "saleStatus", "selector": "//li[contains(@class,\"product_attribute-row\")][b[contains(text(),\"Vehicle Status\")]]/span", "attribute": null, "transform": "trimText"}
]'::jsonb
WHERE "name" = 'Freedom Motors'
  AND "mappings" = '[]'::jsonb;
