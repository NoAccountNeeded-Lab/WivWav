-- Narrow the mostly-NULL single-column `listings` indexes to their NOT NULL
-- subset so NULL entries — the common case for both columns — stop paying
-- write amplification on every ingest upsert. `vin` is only populated for
-- listings with a valid 17-char VIN (vehicle-identity enrichment); every
-- read path filters `vin = <value>` or `vin IS NOT NULL`, both of which
-- imply the predicate. `processingLockedAt` is only set while a job holds
-- a row lock (see apps/api/src/jobs/listing-lock.ts); the lock-staleness
-- probe (`"processingLockedAt" < <threshold>`) implies the predicate, and
-- lock acquisition itself is PK-addressed.
-- Precedent: `listings_private_seller_retention_idx` (see
-- 20260820052054_add_listing_retention_applied_at). The WHERE clauses
-- aren't representable in schema.prisma's @@index, so the schema declares
-- the unfiltered column sets and this migration is the source of truth for
-- the predicates.
DROP INDEX "listings_vin_idx";
CREATE INDEX "listings_vin_idx" ON "listings"("vin")
  WHERE "vin" IS NOT NULL;

DROP INDEX "listings_processingLockedAt_idx";
CREATE INDEX "listings_processingLockedAt_idx" ON "listings"("processingLockedAt")
  WHERE "processingLockedAt" IS NOT NULL;
