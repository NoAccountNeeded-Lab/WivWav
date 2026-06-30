-- CreateEnum
CREATE TYPE "VehicleIdentityDecisionState" AS ENUM ('candidate', 'verified', 'rejected', 'split');

-- CreateTable
-- Auditable record of a vehicle-identity matching decision between two listings.
-- listingAId is always the lexicographically smaller of the two listing ids so a
-- given pair has exactly one row (idempotent upsert key) regardless of comparison order.
CREATE TABLE "vehicle_identity_decision" (
    "id" TEXT NOT NULL,
    "listingAId" TEXT NOT NULL,
    "listingBId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "state" "VehicleIdentityDecisionState" NOT NULL,
    "signals" JSONB NOT NULL,
    "ruleId" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_identity_decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_identity_decision_listingAId_listingBId_key"
ON "vehicle_identity_decision"("listingAId", "listingBId");

-- CreateIndex
CREATE INDEX "vehicle_identity_decision_listingAId_idx"
ON "vehicle_identity_decision"("listingAId");

-- CreateIndex
CREATE INDEX "vehicle_identity_decision_listingBId_idx"
ON "vehicle_identity_decision"("listingBId");

-- CreateIndex
CREATE INDEX "vehicle_identity_decision_vehicleId_idx"
ON "vehicle_identity_decision"("vehicleId");

-- CreateIndex
CREATE INDEX "vehicle_identity_decision_state_idx"
ON "vehicle_identity_decision"("state");

-- AddForeignKey
ALTER TABLE "vehicle_identity_decision"
ADD CONSTRAINT "vehicle_identity_decision_listingAId_fkey"
FOREIGN KEY ("listingAId") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_identity_decision"
ADD CONSTRAINT "vehicle_identity_decision_listingBId_fkey"
FOREIGN KEY ("listingBId") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_identity_decision"
ADD CONSTRAINT "vehicle_identity_decision_vehicleId_fkey"
FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
