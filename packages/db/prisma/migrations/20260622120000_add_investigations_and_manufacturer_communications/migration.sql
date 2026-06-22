-- CreateTable
CREATE TABLE "investigation" (
    "id" TEXT NOT NULL,
    "nhtsaId" TEXT NOT NULL,
    "vehicleModelId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "openedDate" TIMESTAMP(3) NOT NULL,
    "closedDate" TIMESTAMP(3),
    "outcome" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturer_communication" (
    "id" TEXT NOT NULL,
    "nhtsaId" TEXT NOT NULL,
    "vehicleModelId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "issuedDate" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manufacturer_communication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investigation_nhtsaId_key" ON "investigation"("nhtsaId");

-- CreateIndex
CREATE INDEX "investigation_vehicleModelId_idx" ON "investigation"("vehicleModelId");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturer_communication_nhtsaId_key" ON "manufacturer_communication"("nhtsaId");

-- CreateIndex
CREATE INDEX "manufacturer_communication_vehicleModelId_idx" ON "manufacturer_communication"("vehicleModelId");

-- AddForeignKey
ALTER TABLE "investigation" ADD CONSTRAINT "investigation_vehicleModelId_fkey" FOREIGN KEY ("vehicleModelId") REFERENCES "vehicle_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturer_communication" ADD CONSTRAINT "manufacturer_communication_vehicleModelId_fkey" FOREIGN KEY ("vehicleModelId") REFERENCES "vehicle_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
