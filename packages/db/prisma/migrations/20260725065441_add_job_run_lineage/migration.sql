-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('running', 'succeeded', 'failed');

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "lastRunId" TEXT;

-- CreateTable
CREATE TABLE "job_run" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "sourceId" TEXT,
    "parentRunId" TEXT,
    "status" "JobRunStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "succeededCount" INTEGER,
    "failedCount" INTEGER,
    "errorMessage" TEXT,

    CONSTRAINT "job_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_run_sourceId_idx" ON "job_run"("sourceId");

-- CreateIndex
CREATE INDEX "job_run_parentRunId_idx" ON "job_run"("parentRunId");

-- CreateIndex
CREATE INDEX "job_run_jobType_startedAt_idx" ON "job_run"("jobType", "startedAt");

-- CreateIndex
CREATE INDEX "job_run_status_idx" ON "job_run"("status");

-- CreateIndex
CREATE INDEX "listings_lastRunId_idx" ON "listings"("lastRunId");

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_lastRunId_fkey" FOREIGN KEY ("lastRunId") REFERENCES "job_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_run" ADD CONSTRAINT "job_run_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_run" ADD CONSTRAINT "job_run_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "job_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
