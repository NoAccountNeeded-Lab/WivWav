-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "retentionAppliedAt" TIMESTAMP(3);

-- CreateIndex
-- Partial: narrowed to outstanding candidates so the sweep's query stays
-- cheap for the life of the table instead of degrading as more rows get
-- anonymized. Precedent: listings_possibly_gone_missing_count_idx (see
-- 20260629120000_add_crawl_freshness_tracking) narrows its index the same
-- way; the WHERE clause isn't representable in schema.prisma's @@index, so
-- the schema declares the unfiltered column set and this migration is the
-- source of truth for the predicate.
CREATE INDEX "listings_private_seller_retention_idx" ON "listings"("sellerType", "status", "goneAt")
  WHERE "retentionAppliedAt" IS NULL;
