/*
  Warnings:

  - You are about to drop the column `searchSyncedAt` on the `listing_observation` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "listing_observation" DROP COLUMN "searchSyncedAt";
