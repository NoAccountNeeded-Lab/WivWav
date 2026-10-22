-- CreateEnum
CREATE TYPE "DealerSiteCandidateStatus" AS ENUM ('pending_review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "DealerSiteDiscovery" AS ENUM ('listing_dealer_website', 'google_places');

-- AlterTable
ALTER TABLE "dealer_profiles" ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "dealer_site_candidate" (
    "id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "sampleUrl" TEXT NOT NULL,
    "status" "DealerSiteCandidateStatus" NOT NULL DEFAULT 'pending_review',
    "discoveredVia" "DealerSiteDiscovery" NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "listingCount" INTEGER NOT NULL DEFAULT 0,
    "dealerProfileId" TEXT,
    "dealerName" TEXT,

    CONSTRAINT "dealer_site_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dealer_site_candidate_origin_key" ON "dealer_site_candidate"("origin");

-- CreateIndex
CREATE INDEX "dealer_site_candidate_status_listingCount_idx" ON "dealer_site_candidate"("status", "listingCount");

-- CreateIndex
CREATE INDEX "dealer_site_candidate_dealerProfileId_idx" ON "dealer_site_candidate"("dealerProfileId");

-- AddForeignKey
ALTER TABLE "dealer_site_candidate" ADD CONSTRAINT "dealer_site_candidate_dealerProfileId_fkey" FOREIGN KEY ("dealerProfileId") REFERENCES "dealer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

