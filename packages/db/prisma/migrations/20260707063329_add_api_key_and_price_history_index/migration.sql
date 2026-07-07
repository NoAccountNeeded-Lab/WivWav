-- CreateEnum
CREATE TYPE "ApiKeyTier" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');

-- CreateTable
CREATE TABLE "api_key" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "tier" "ApiKeyTier" NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_key_keyHash_key" ON "api_key"("keyHash");

-- CreateIndex
CREATE INDEX "listing_price_history_recordedAt_idx" ON "listing_price_history"("recordedAt");
