-- CreateTable
CREATE TABLE "search_indexer_checkpoint" (
    "id" TEXT NOT NULL,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,
    "lastId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_indexer_checkpoint_pkey" PRIMARY KEY ("id")
);
