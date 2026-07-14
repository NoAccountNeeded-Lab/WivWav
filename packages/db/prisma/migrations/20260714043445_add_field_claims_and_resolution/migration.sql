-- CreateEnum
CREATE TYPE "FieldResolutionState" AS ENUM ('verified', 'source_reported', 'conflicting', 'unknown');

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "conversionTypeResolution" "FieldResolutionState" NOT NULL DEFAULT 'unknown',
ADD COLUMN     "rampTypeResolution" "FieldResolutionState" NOT NULL DEFAULT 'unknown';

-- CreateTable
CREATE TABLE "listing_field_claim" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "claimedValue" TEXT NOT NULL,
    "evidenceKind" TEXT NOT NULL,
    "sourceRef" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extractorVersion" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "ineligibleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_field_claim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_field_claim_listingId_field_idx" ON "listing_field_claim"("listingId", "field");

-- CreateIndex
CREATE INDEX "listing_field_claim_listingId_field_evidenceKind_sourceRef__idx" ON "listing_field_claim"("listingId", "field", "evidenceKind", "sourceRef", "observedAt");

-- CreateIndex
CREATE INDEX "listings_status_conversionTypeResolution_idx" ON "listings"("status", "conversionTypeResolution");

-- CreateIndex
CREATE INDEX "listings_status_rampTypeResolution_idx" ON "listings"("status", "rampTypeResolution");

-- AddForeignKey
ALTER TABLE "listing_field_claim" ADD CONSTRAINT "listing_field_claim_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
