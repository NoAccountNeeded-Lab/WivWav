ALTER TABLE "listings"
  ADD COLUMN "readinessBlockers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "listings"
  ADD COLUMN "readinessComputedAt" TIMESTAMP(3);
