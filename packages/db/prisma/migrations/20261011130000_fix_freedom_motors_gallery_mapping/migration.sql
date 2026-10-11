-- Freedom Motors changed its gallery markup (#1105): slides no longer carry
-- data-large_image; the full-size URL is now data-popup-src on the slide div.
-- Replace only the `images` element of Source.mappings, and only while it
-- still holds the old seeded value, so an operator or AI remap is never
-- clobbered. Keep in sync with
-- packages/scraper-sources/src/sources/freedom-motors-detail-mappings.ts.
UPDATE "sources"
SET "mappings" = (
  SELECT jsonb_agg(
    CASE
      WHEN e.elem = '{"targetField": "images", "selector": ".images .woocommerce-product-gallery__image img.wp-post-image", "attribute": "data-large_image", "transform": null}'::jsonb
      THEN '{"targetField": "images", "selector": ".images .woocommerce-product-gallery__image[data-popup-type=\"image\"]", "attribute": "data-popup-src", "transform": null}'::jsonb
      ELSE e.elem
    END
    ORDER BY e.ord
  )
  FROM jsonb_array_elements("mappings") WITH ORDINALITY AS e(elem, ord)
)
WHERE "name" = 'Freedom Motors'
  AND "mappings" @> '[{"targetField": "images", "selector": ".images .woocommerce-product-gallery__image img.wp-post-image", "attribute": "data-large_image"}]'::jsonb;
