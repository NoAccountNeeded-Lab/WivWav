import type { FieldMapping } from '@wivwav/types'

/**
 * Seed field mappings for Freedom Motors' detail-page declarative extractor
 * (#822). Written to `Source.mappings` for the "Freedom Motors" row —
 * see registry.ts (fresh-install seeding) and the
 * seed_freedom_motors_detail_mappings migration (backfill for a row that
 * already existed before this change). Operators/the AI remap loop
 * (scraper-engine.ts's `setMappings`) may replace this at any time; nothing
 * in the detail-extract pipeline depends on these exact values, only on the
 * shape (see declarative-detail.ts).
 *
 * Selectors target the real WooCommerce spec-block markup confirmed against
 * https://www.freedommotors.com/product/wheelchair-suv/2025-kia-telluride-ex-6/
 * on 2026-07-17 — `<li class="product_attribute-row"><b>Label:</b>
 * <span>Value</span></li>` pairs with no stable per-field class/id, hence
 * the XPath label-text selectors (see declarative-detail.ts's doc comment
 * for why plain CSS can't express this).
 */
export const FREEDOM_MOTORS_DETAIL_MAPPINGS: FieldMapping[] = [
  {
    targetField: 'images',
    selector: '.images .woocommerce-product-gallery__image img.wp-post-image',
    attribute: 'data-large_image',
    transform: null,
  },
  {
    targetField: 'color',
    selector: '//li[contains(@class,"product_attribute-row")][b[contains(text(),"Exterior Color")]]/span',
    attribute: null,
    transform: 'trimText',
  },
  {
    targetField: 'fuelType',
    selector: '//li[contains(@class,"product_attribute-row")][b[contains(text(),"Fuel Type")]]/span',
    attribute: null,
    transform: 'trimText',
  },
  {
    targetField: 'engine',
    selector: '//li[contains(@class,"product_attribute-row")][b[contains(text(),"Engine")]]/span',
    attribute: null,
    transform: 'trimText',
  },
  {
    targetField: 'transmission',
    selector: '//li[contains(@class,"product_attribute-row")][b[contains(text(),"Trans")]]/span',
    attribute: null,
    transform: 'trimText',
  },
  {
    targetField: 'conversionType',
    selector: '//li[contains(@class,"product_attribute-row")][b[contains(text(),"Conversion Location")]]/span',
    attribute: null,
    transform: 'trimText',
  },
  {
    targetField: 'saleStatus',
    selector: '//li[contains(@class,"product_attribute-row")][b[contains(text(),"Vehicle Status")]]/span',
    attribute: null,
    transform: 'trimText',
  },
]
