-- CreateIndex
CREATE INDEX "scraper_runs_sourceId_markGoneAppliedAt_idx" ON "scraper_runs"("sourceId", "markGoneAppliedAt");
