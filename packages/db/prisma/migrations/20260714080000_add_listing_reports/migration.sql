CREATE TYPE "ListingReportType" AS ENUM ('specs_incorrect', 'sold_or_stale', 'duplicate', 'other');

CREATE TYPE "ListingReportStatus" AS ENUM ('unresolved', 'resolved');

CREATE TABLE "listing_reports" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "reportType" "ListingReportType" NOT NULL,
    "notes" TEXT,
    "status" "ListingReportStatus" NOT NULL DEFAULT 'unresolved',
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "listing_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "listing_reports_listingId_status_idx" ON "listing_reports"("listingId", "status");
CREATE INDEX "listing_reports_status_reportedAt_idx" ON "listing_reports"("status", "reportedAt");

ALTER TABLE "listing_reports"
ADD CONSTRAINT "listing_reports_listingId_fkey"
FOREIGN KEY ("listingId") REFERENCES "listings"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
