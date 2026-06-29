-- Add engine column to store raw engine description strings separately from fuelType.
-- This prevents engine descriptions (e.g. "3.5L V6 DOHC") from being exposed as
-- fuel type in public facets. color already stores the raw source color for provenance.
-- Existing rows are unchanged; backfill is performed by canonicalize-backfill.ts.
ALTER TABLE "listings" ADD COLUMN "engine" TEXT;
