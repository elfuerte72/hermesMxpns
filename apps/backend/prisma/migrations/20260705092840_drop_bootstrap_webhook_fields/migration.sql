/*
  Warnings:

  - You are about to drop the column `bootstrap_token_hash` on the `deploys` table. All the data in the column will be lost.
  - You are about to drop the column `bootstrap_used_at` on the `deploys` table. All the data in the column will be lost.
  - You are about to drop the column `hostinger_script_id` on the `deploys` table. All the data in the column will be lost.
  - You are about to drop the column `webhook_secret_hash` on the `deploys` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "deploys" DROP COLUMN "bootstrap_token_hash",
DROP COLUMN "bootstrap_used_at",
DROP COLUMN "hostinger_script_id",
DROP COLUMN "webhook_secret_hash";
