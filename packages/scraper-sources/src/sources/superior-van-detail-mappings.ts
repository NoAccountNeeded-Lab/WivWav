import type { FieldMapping } from '@wivwav/types'

/**
 * Seed field mappings for Superior Van & Mobility's detail-page declarative
 * extractor (#822, applied to a second, differently-templated site by
 * #823). Written to `Source.mappings` for the "Superior Van & Mobility" row
 * — see registry.ts (fresh-install seeding) and the
 * seed_superior_van_detail_mappings migration (backfill for the row that
 * already existed before this change, previously `pipeline: 'scrape-only'`).
 * Operators/the AI remap loop (scraper-engine.ts's `setMappings`) may
 * replace this at any time; nothing in the detail-extract pipeline depends
 * on these exact values, only on the shape (see declarative-detail.ts).
 *
 * Selectors target the real Elementor/FacetWP detail-page markup confirmed
 * against https://superiorvan.com/inventory/2014-braunability-dodge-grand-
 * caravan-2c4rdgcg7er476983/ on 2026-08-20:
 *
 *   <div class="vehicle-gallery"><div class="vehicle-gallery-item">
 *     <a href="…jpg"><img src="…jpg" alt="" loading="lazy"></a>
 *   </div>…</div>
 *
 *   <li class="elementor-icon-list-item elementor-inline-item">
 *     <span class="elementor-icon-list-text"><b>Exterior Color:</b> Redline 2 Coat Pearl</span>
 *   </li>
 *
 * Unlike Freedom Motors' markup (label `<b>` and value `<span>` are
 * siblings), Superior Van's label and value share one text node inside the
 * same `<span>` — the XPath selector below matches that whole span by its
 * `<b>` label text, and the 'afterColon' transform (field-transforms.ts)
 * strips the "Label:" prefix from the combined innerText, since a plain CSS
 * selector has no way to select "the text after this inline element" and
 * declarative mappings only resolve through the fixed transform library,
 * never arbitrary script.
 *
 * Interior color is visible on the page (`Interior Color:` spec row) but is
 * deliberately NOT mapped here — there is no `interiorColor` field on
 * `Listing`/`DetailResult` for it to land in (Freedom Motors' own detail
 * page has the same field with the same omission, #822). Adding storage for
 * it is a schema change out of scope for this declarative-mapping issue; see
 * the #823 closing evaluation comment.
 *
 * `conversionType`/`rampType` are also deliberately unmapped: the card
 * scraper already derives both, reliably, from the listing-card's CSS class
 * tokens (superior-van.ts's `ramp-location-*`/`ramp-type-*`), and detail
 * extraction never overwrites a field when its evidence is 'missing' — but
 * there is no upside to a second, text-parsed source of truth for the same
 * claim when the card-scrape one is already structural rather than
 * free-text. `saleStatus` is unmapped for the same reason it doesn't exist
 * on this template at all — no "Vehicle Status" (or equivalent) spec row is
 * rendered on the detail page.
 */
export const SUPERIOR_VAN_DETAIL_MAPPINGS: FieldMapping[] = [
  {
    targetField: 'images',
    selector: '.vehicle-gallery .vehicle-gallery-item img',
    attribute: 'src',
    transform: null,
  },
  {
    targetField: 'color',
    selector: '//span[contains(@class,"elementor-icon-list-text")][b[contains(text(),"Exterior Color")]]',
    attribute: null,
    transform: 'afterColon',
  },
  {
    targetField: 'fuelType',
    selector: '//span[contains(@class,"elementor-icon-list-text")][b[contains(text(),"Fuel Type")]]',
    attribute: null,
    transform: 'afterColon',
  },
]
