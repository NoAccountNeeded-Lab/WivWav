-- AlterTable
ALTER TABLE "api_key" ADD COLUMN     "rateLimitRpm" INTEGER NOT NULL DEFAULT 60;
