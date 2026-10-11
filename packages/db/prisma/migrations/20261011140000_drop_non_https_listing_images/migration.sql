-- Remove non-https image URLs from listings.images / listings.cardImages (#1136).
-- Ingest now stores only https: URLs; this cleans rows written before that.
-- Order is preserved via WITH ORDINALITY. Only rows with a non-https entry are
-- touched, and updatedAt is bumped so the incremental search indexer reindexes.
UPDATE "listings" AS l
SET "images" = array(
      SELECT u.url
      FROM unnest(l."images") WITH ORDINALITY AS u(url, ord)
      WHERE u.url ~* '^https://'
      ORDER BY u.ord
    ),
    "cardImages" = array(
      SELECT c.url
      FROM unnest(l."cardImages") WITH ORDINALITY AS c(url, ord)
      WHERE c.url ~* '^https://'
      ORDER BY c.ord
    ),
    "updatedAt" = NOW()
WHERE EXISTS (SELECT 1 FROM unnest(l."images") AS x(url) WHERE x.url !~* '^https://')
   OR EXISTS (SELECT 1 FROM unnest(l."cardImages") AS y(url) WHERE y.url !~* '^https://');
