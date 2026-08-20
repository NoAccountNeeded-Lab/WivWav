-- AlterTable
ALTER TABLE "scraper_runs" ADD COLUMN     "isCompleteCrawl" BOOLEAN,
ADD COLUMN     "markGoneNewlyGoneCount" INTEGER;
