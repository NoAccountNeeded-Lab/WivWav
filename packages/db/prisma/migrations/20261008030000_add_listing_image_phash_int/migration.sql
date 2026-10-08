-- AlterTable
ALTER TABLE "listing_image" ADD COLUMN     "pHashInt" BIGINT;

-- CreateIndex
CREATE INDEX "listing_image_pHashInt_idx" ON "listing_image"("pHashInt");

-- Backfill `pHashInt` for rows written before the app-side dual-write landed.
-- Same conversion the app performs (`pHashHexToInt`): unsigned 16-char hex
-- reinterpreted as signed int64 (hashes with the high bit set store negative;
-- XOR/popcount over two's-complement bits is unaffected).
UPDATE "listing_image"
SET "pHashInt" = (('x' || "listing_image"."pHash")::bit(64)::bigint)
WHERE "listing_image"."pHash" IS NOT NULL
  AND "listing_image"."pHashInt" IS NULL;

