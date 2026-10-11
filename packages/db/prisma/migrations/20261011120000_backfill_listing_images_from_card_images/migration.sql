-- Backfill listings whose detail stage never supplied images (#1105).
-- Only rows with no images at all are touched, so detail-extracted galleries
-- are never overwritten. Ingest now seeds `images` from the card on update
-- (listing-ingest.ts); this covers rows that predate that change.
-- updatedAt is bumped so the incremental search indexer picks the rows up.
UPDATE "listings"
SET "images" = "cardImages",
    "updatedAt" = NOW()
WHERE cardinality("images") = 0
  AND cardinality("cardImages") > 0;
