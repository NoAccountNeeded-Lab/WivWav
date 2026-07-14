-- Preserve seller/source publication dates separately from WAV Search scrape timestamps.
ALTER TABLE "listings"
ADD COLUMN "sourceListedAt" TIMESTAMP(3),
ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3);
