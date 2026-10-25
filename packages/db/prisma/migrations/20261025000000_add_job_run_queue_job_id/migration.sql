ALTER TABLE "job_run" ADD COLUMN "queueJobId" TEXT;

CREATE INDEX "job_run_jobType_queueJobId_idx" ON "job_run"("jobType", "queueJobId");
