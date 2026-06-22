-- CreateTable
CREATE TABLE "listing_mileage_history" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "mileage" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_mileage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_conversion_history" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "conversionStatus" "ConversionStatus" NOT NULL,
    "wavFeatures" "WavFeature"[] NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_conversion_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_mileage_history_listingId_recordedAt_idx" ON "listing_mileage_history"("listingId", "recordedAt");

-- CreateIndex
CREATE INDEX "listing_conversion_history_listingId_recordedAt_idx" ON "listing_conversion_history"("listingId", "recordedAt");

-- AddForeignKey
ALTER TABLE "listing_mileage_history" ADD CONSTRAINT "listing_mileage_history_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_conversion_history" ADD CONSTRAINT "listing_conversion_history_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
