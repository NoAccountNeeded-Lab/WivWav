CREATE TYPE "OpsProblemSource" AS ENUM ('domain', 'grafana', 'sentry');

CREATE TABLE "ops_problem_state" (
    "fingerprint" TEXT NOT NULL,
    "source" "OpsProblemSource" NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrence_count" INTEGER NOT NULL DEFAULT 0,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by" TEXT,

    CONSTRAINT "ops_problem_state_pkey" PRIMARY KEY ("fingerprint")
);

CREATE INDEX "ops_problem_state_source_idx" ON "ops_problem_state"("source");
CREATE INDEX "ops_problem_state_last_seen_at_idx" ON "ops_problem_state"("last_seen_at");
CREATE INDEX "ops_problem_state_acknowledged_at_idx" ON "ops_problem_state"("acknowledged_at");
