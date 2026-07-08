/*
  Warnings:

  - You are about to drop the column `paid_until` on the `deploys` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "deploys" DROP COLUMN "paid_until",
ADD COLUMN     "bot_token_status" TEXT,
ADD COLUMN     "openrouter_key_hash" TEXT,
ADD COLUMN     "subscription_channel_id" BIGINT,
ADD COLUMN     "subscription_status" TEXT,
ADD COLUMN     "subscription_until" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "deploys_subscription_status_idx" ON "deploys"("subscription_status");
