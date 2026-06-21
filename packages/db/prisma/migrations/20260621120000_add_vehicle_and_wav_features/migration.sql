-- CreateEnum: ConversionStatus
CREATE TYPE "ConversionStatus" AS ENUM ('proposed', 'complete', 'unknown');

-- CreateEnum: WavFeature
CREATE TYPE "WavFeature" AS ENUM ('hand_controls', 'transfer_seat', 'has_lift', 'kneel_system', 'lowered_floor', 'power_ramp', 'tie_down_system', 'automatic_door', 'motorized_running_board');

-- CreateTable: vehicle
CREATE TABLE "vehicle" (
    "id" TEXT NOT NULL,
    "vin" TEXT,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "trim" TEXT,
    "vehicleModelId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: vehicle unique VIN (partial — Postgres allows multiple NULLs)
CREATE UNIQUE INDEX "vehicle_vin_key" ON "vehicle"("vin");

-- CreateIndex: vehicle make/model/year lookup
CREATE INDEX "vehicle_make_model_year_idx" ON "vehicle"("make", "model", "year");

-- AddForeignKey: vehicle.vehicleModelId -> vehicle_models.id
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_vehicleModelId_fkey" FOREIGN KEY ("vehicleModelId") REFERENCES "vehicle_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: listings — add vehicleId, conversionStatus, wavFeatures; remove booleans
ALTER TABLE "listings"
    ADD COLUMN "vehicleId" TEXT,
    ADD COLUMN "conversionStatus" "ConversionStatus" NOT NULL DEFAULT 'unknown',
    ADD COLUMN "wavFeatures" "WavFeature"[] NOT NULL DEFAULT '{}';

ALTER TABLE "listings"
    DROP COLUMN "hasLift",
    DROP COLUMN "handControls",
    DROP COLUMN "transferSeat";

-- AddForeignKey: listings.vehicleId -> vehicle.id
ALTER TABLE "listings" ADD CONSTRAINT "listings_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: vehicleId + status (for per-vehicle listing queries)
CREATE INDEX "listings_vehicleId_status_idx" ON "listings"("vehicleId", "status");

-- CreateIndex: vehicleId + listedAt (for per-vehicle timeline queries)
CREATE INDEX "listings_vehicleId_listedAt_idx" ON "listings"("vehicleId", "listedAt");

-- GIN index on wavFeatures for array-containment queries
CREATE INDEX "listings_wav_features_gin" ON "listings" USING GIN ("wavFeatures");
