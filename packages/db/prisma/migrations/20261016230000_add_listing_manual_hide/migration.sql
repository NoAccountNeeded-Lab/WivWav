-- #1157 operator manual suppression (additive, nullable; no backfill).
ALTER TABLE "listings" ADD COLUMN "manuallyHiddenAt" TIMESTAMP(3),
ADD COLUMN "manualHideReason" TEXT;
