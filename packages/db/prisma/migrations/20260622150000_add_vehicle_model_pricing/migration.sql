-- CreateTable
CREATE TABLE "vehicle_model_pricing" (
    "id" TEXT NOT NULL,
    "vehicleModelId" TEXT NOT NULL,
    "originalMsrpCents" INTEGER,
    "destinationFeeCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceFetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourcePayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_model_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_model_pricing_vehicleModelId_key" ON "vehicle_model_pricing"("vehicleModelId");

-- AddForeignKey
ALTER TABLE "vehicle_model_pricing" ADD CONSTRAINT "vehicle_model_pricing_vehicleModelId_fkey" FOREIGN KEY ("vehicleModelId") REFERENCES "vehicle_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;
