-- #1157 operator manual suppression (additive, nullable; no backfill).
ALTER TABLE "listings" ADD COLUMN "manuallyHiddenAt" TIMESTAMP(3),
ADD COLUMN "manualHideReason" TEXT;

-- A hidden listing can never be eligible (and so never indexed or served), even
-- if a writer races a hide. Writers also guard with manuallyHiddenAt IS NULL.
ALTER TABLE "listings" ADD CONSTRAINT "listings_hidden_not_eligible_check"
  CHECK ("manuallyHiddenAt" IS NULL OR "publicationStatus" <> 'eligible');
