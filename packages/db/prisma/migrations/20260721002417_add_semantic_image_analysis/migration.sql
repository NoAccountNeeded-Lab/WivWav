-- AlterTable
ALTER TABLE "listing_image" ADD COLUMN     "semanticAnalysisVersion" INTEGER;

-- CreateTable
CREATE TABLE "listing_image_semantic_analysis" (
    "id" TEXT NOT NULL,
    "listingImageId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "semanticAnalysisVersion" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "schemaVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "labels" JSONB NOT NULL DEFAULT '[]',
    "fieldClaims" JSONB NOT NULL DEFAULT '[]',
    "altText" TEXT,
    "summary" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_image_semantic_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_image_semantic_analysis_listingImageId_idx" ON "listing_image_semantic_analysis"("listingImageId");

-- CreateIndex
CREATE UNIQUE INDEX "listing_image_semantic_analysis_listingImageId_contentHash__key" ON "listing_image_semantic_analysis"("listingImageId", "contentHash", "semanticAnalysisVersion");

-- AddForeignKey
ALTER TABLE "listing_image_semantic_analysis" ADD CONSTRAINT "listing_image_semantic_analysis_listingImageId_fkey" FOREIGN KEY ("listingImageId") REFERENCES "listing_image"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
