-- Add rolling EWMA baselines for per-source error/missing rates so abrupt
-- drift can be detected relative to each source's own normal behavior,
-- rather than only against the fixed systemic-error threshold.
-- NULL means no baseline has been observed yet (first run after this migration).
ALTER TABLE "sources"
ADD COLUMN "baselineErrorRate" DOUBLE PRECISION,
ADD COLUMN "baselineMissingRate" DOUBLE PRECISION;
