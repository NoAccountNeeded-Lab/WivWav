-- Migration: add crawl freshness tracking
--
-- Source-level: record when a complete (all-pages) crawl last ran and how many
-- consecutive complete crawls have returned no results for the source.
--
-- Listing-level: track how many consecutive complete source crawls have NOT
-- included this listing (missing-from-complete count) and when the listing
-- was last confirmed present in a complete crawl. These two columns drive
-- the consecutive-observation policy that transitions listings from
-- possibly_gone to gone without relying solely on detail-page signals.

ALTER TABLE "sources"
  ADD COLUMN "lastFullCrawlAt"          TIMESTAMP(3),
  ADD COLUMN "lastObservedAt"           TIMESTAMP(3);

ALTER TABLE "listings"
  ADD COLUMN "missingFromCompleteCount"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastSeenInCompleteCrawlAt"   TIMESTAMP(3);

-- Index to quickly find listings that are possibly_gone with a high missing
-- count — the primary query for the consecutive-observation gone transition.
CREATE INDEX "listings_possibly_gone_missing_count_idx"
  ON "listings" ("sourceId", "status", "missingFromCompleteCount")
  WHERE "status" = 'possibly_gone';
