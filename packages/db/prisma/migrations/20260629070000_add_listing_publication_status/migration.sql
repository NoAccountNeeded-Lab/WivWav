-- CreateEnum
CREATE TYPE "ListingPublicationStatus" AS ENUM ('pending', 'eligible', 'quarantined');

-- AlterTable
-- Existing and newly observed listings are intentionally default-deny. A
-- separate validator must explicitly mark a row eligible for publication.
ALTER TABLE "listings"
ADD COLUMN "publicationStatus" "ListingPublicationStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN "qualityIssueCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "qualityCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "listings_status_publicationStatus_idx"
ON "listings"("status", "publicationStatus");

-- CreateIndex
CREATE INDEX "listings_publicationStatus_idx"
ON "listings"("publicationStatus");
