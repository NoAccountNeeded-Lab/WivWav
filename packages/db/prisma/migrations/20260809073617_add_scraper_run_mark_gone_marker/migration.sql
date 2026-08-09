-- AlterTable
ALTER TABLE "scraper_runs" ADD COLUMN     "markGoneAppliedAt" TIMESTAMP(3),
ADD COLUMN     "markGoneNewlyMissingCount" INTEGER;
