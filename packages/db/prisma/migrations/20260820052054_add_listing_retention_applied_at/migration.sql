-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "retentionAppliedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "listings_private_seller_retention_idx" ON "listings"("sellerType", "status", "goneAt");
