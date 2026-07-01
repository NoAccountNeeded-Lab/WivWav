-- CreateEnum
CREATE TYPE "ImageKind" AS ENUM ('vehicle_photo', 'placeholder', 'site_chrome', 'excluded');

-- CreateTable
-- Per-image metadata record. Raw image bytes are never persisted — only hashes.
CREATE TABLE "listing_image" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "ImageKind" NOT NULL DEFAULT 'vehicle_photo',
    "widthPx" INTEGER,
    "heightPx" INTEGER,
    "exactHash" TEXT,
    "pHash" TEXT,
    "analysisVersion" INTEGER NOT NULL DEFAULT 1,
    "clusterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Groups byte-identical (exact) or perceptually similar (near) images across listings.
CREATE TABLE "image_cluster" (
    "id" TEXT NOT NULL,
    "clusterType" TEXT NOT NULL,
    "representativeHash" TEXT NOT NULL,
    "listingCount" INTEGER NOT NULL DEFAULT 0,
    "sourceCount" INTEGER NOT NULL DEFAULT 0,
    "vehicleCount" INTEGER NOT NULL DEFAULT 0,
    "crossVehicle" BOOLEAN NOT NULL DEFAULT false,
    "isPlaceholder" BOOLEAN NOT NULL DEFAULT false,
    "reasonCode" TEXT,
    "analysisVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "image_cluster_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "listing_image_listingId_originalUrl_key"
ON "listing_image"("listingId", "originalUrl");

-- CreateIndex
CREATE INDEX "listing_image_listingId_idx" ON "listing_image"("listingId");

-- CreateIndex
CREATE INDEX "listing_image_exactHash_idx" ON "listing_image"("exactHash");

-- CreateIndex
CREATE INDEX "listing_image_pHash_idx" ON "listing_image"("pHash");

-- CreateIndex
CREATE INDEX "listing_image_clusterId_idx" ON "listing_image"("clusterId");

-- CreateIndex
CREATE INDEX "listing_image_normalizedUrl_idx" ON "listing_image"("normalizedUrl");

-- CreateIndex
CREATE UNIQUE INDEX "image_cluster_clusterType_representativeHash_key"
ON "image_cluster"("clusterType", "representativeHash");

-- CreateIndex
CREATE INDEX "image_cluster_clusterType_idx" ON "image_cluster"("clusterType");

-- CreateIndex
CREATE INDEX "image_cluster_isPlaceholder_idx" ON "image_cluster"("isPlaceholder");

-- CreateIndex
CREATE INDEX "image_cluster_crossVehicle_idx" ON "image_cluster"("crossVehicle");

-- AddForeignKey
ALTER TABLE "listing_image"
ADD CONSTRAINT "listing_image_listingId_fkey"
FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_image"
ADD CONSTRAINT "listing_image_clusterId_fkey"
FOREIGN KEY ("clusterId") REFERENCES "image_cluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
