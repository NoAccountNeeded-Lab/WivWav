-- CreateIndex
-- Partial: the resolve drain only ever reads non-gone rows
-- (`status <> 'gone'` in `resolveSourceBacklog`), so gone rows — the
-- table's long-term majority — stay out of the index instead of
-- accumulating in it. Precedent: `listings_private_seller_retention_idx`
-- (see 20260820052054_add_listing_retention_applied_at) narrows its index
-- the same way; the WHERE clause isn't representable in schema.prisma's
-- @@index, so the schema declares the unfiltered column set and this
-- migration is the source of truth for the predicate.
CREATE INDEX "listings_resolve_drain_idx" ON "listings"("sourceId", "publicationStatus", "id")
  WHERE "status" <> 'gone';

-- CreateIndex
CREATE INDEX "listings_market_status_pub_make_model_idx" ON "listings"("status", "publicationStatus", "make", "model");
