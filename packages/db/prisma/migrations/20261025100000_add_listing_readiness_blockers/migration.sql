ALTER TABLE "listings"
  ADD COLUMN "readinessBlockers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
