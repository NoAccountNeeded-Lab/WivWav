ALTER TABLE "listings"
ADD COLUMN "cardImages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "listing_observation" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "reference" TEXT,
    "extractionVersion" TEXT NOT NULL,
    "changedFields" TEXT[] NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "searchSyncedAt" TIMESTAMP(3),

    CONSTRAINT "listing_observation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "listing_observation_stage_reference_key"
ON "listing_observation"("stage", "reference");

CREATE INDEX "listing_observation_listingId_observedAt_idx"
ON "listing_observation"("listingId", "observedAt");

ALTER TABLE "listing_observation"
ADD CONSTRAINT "listing_observation_listingId_fkey"
FOREIGN KEY ("listingId") REFERENCES "listings"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
