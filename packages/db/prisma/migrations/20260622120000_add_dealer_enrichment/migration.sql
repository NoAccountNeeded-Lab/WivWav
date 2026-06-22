-- CreateTable: dealer_profiles
CREATE TABLE "dealer_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "googlePlaceId" TEXT,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "hours" JSONB,
    "enrichedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dealer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable: dealer_reviews
CREATE TABLE "dealer_reviews" (
    "id" TEXT NOT NULL,
    "dealerId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "dealer_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: dealer_profiles unique googlePlaceId (partial — Postgres allows multiple NULLs)
CREATE UNIQUE INDEX "dealer_profiles_googlePlaceId_key" ON "dealer_profiles"("googlePlaceId");

-- CreateIndex: dealer_profiles unique name+zip
CREATE UNIQUE INDEX "dealer_profiles_name_zip_key" ON "dealer_profiles"("name", "zip");

-- CreateIndex: dealer_reviews unique per dealer+source+date+author (deduplication key)
CREATE UNIQUE INDEX "dealer_reviews_dealerId_source_publishedAt_authorName_key" ON "dealer_reviews"("dealerId", "source", "publishedAt", "authorName");

-- CreateIndex: dealer_reviews dealerId lookup
CREATE INDEX "dealer_reviews_dealerId_idx" ON "dealer_reviews"("dealerId");

-- AddForeignKey: dealer_reviews.dealerId -> dealer_profiles.id
ALTER TABLE "dealer_reviews" ADD CONSTRAINT "dealer_reviews_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: listings — add dealerProfileId FK
ALTER TABLE "listings" ADD COLUMN "dealerProfileId" TEXT;

-- AddForeignKey: listings.dealerProfileId -> dealer_profiles.id
ALTER TABLE "listings" ADD CONSTRAINT "listings_dealerProfileId_fkey" FOREIGN KEY ("dealerProfileId") REFERENCES "dealer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: listings.dealerProfileId — needed for FK cascade performance and dealer→listing queries
CREATE INDEX "listings_dealerProfileId_idx" ON "listings"("dealerProfileId");

-- CreateIndex: listings.dealerName + zip — used by dealer-enrich updateMany to avoid full table scans
CREATE INDEX "listings_dealerName_zip_idx" ON "listings"("dealerName", "zip");
