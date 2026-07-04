-- CreateEnum
CREATE TYPE "DeployStatus" AS ENUM ('pending', 'creating', 'configuring', 'ready', 'failed', 'deleted');

-- CreateTable
CREATE TABLE "users" (
    "telegram_id" BIGINT NOT NULL,
    "username" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("telegram_id")
);

-- CreateTable
CREATE TABLE "deploys" (
    "id" TEXT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "agent" TEXT NOT NULL DEFAULT 'hermes',
    "bot_token_enc" TEXT NOT NULL,
    "bot_username" TEXT NOT NULL,
    "llm_provider" TEXT NOT NULL,
    "llm_key_enc" TEXT NOT NULL,
    "hostinger_vm_id" TEXT,
    "hostinger_script_id" TEXT,
    "status" "DeployStatus" NOT NULL DEFAULT 'pending',
    "bootstrap_token_hash" TEXT NOT NULL,
    "bootstrap_used_at" TIMESTAMP(3),
    "vm_ip" TEXT,
    "paid_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deploys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provisioning_logs" (
    "id" TEXT NOT NULL,
    "deploy_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provisioning_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deploys_user_id_idx" ON "deploys"("user_id");

-- CreateIndex
CREATE INDEX "deploys_status_idx" ON "deploys"("status");

-- CreateIndex
CREATE INDEX "deploys_bot_username_idx" ON "deploys"("bot_username");

-- CreateIndex
CREATE INDEX "provisioning_logs_deploy_id_idx" ON "provisioning_logs"("deploy_id");

-- AddForeignKey
ALTER TABLE "deploys" ADD CONSTRAINT "deploys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("telegram_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provisioning_logs" ADD CONSTRAINT "provisioning_logs_deploy_id_fkey" FOREIGN KEY ("deploy_id") REFERENCES "deploys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
