import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  LLM_PROVIDERS,
  type AuthenticatedUser,
  type CreateDeployResponse,
  type DeployStatus,
  type DeployView,
  type RestartResponse,
  type UpdateLlmKeyResponse,
} from '@hermes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SecretsService } from '../secrets/secrets.service';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { renderComposeFile, renderConfigYaml, renderEnvFile } from '../provisioning/hermes-config';
import { hermesProjectName } from '../workers/deploy.processor';
import { ValidateBotTokenService } from './validate-bot-token.service';
import { ValidateLlmKeyService } from './validate-llm-key.service';
import { DeployQueue } from './deploy-queue';
import { TeardownQueue } from './teardown-queue';
import type { CreateDeployDto } from './create-deploy.dto';
import type { ValidateLlmKeyDto } from './validate-llm-key.dto';

@Injectable()
export class DeploysService {
  private readonly logger = new Logger(DeploysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly validateBotToken: ValidateBotTokenService,
    private readonly queue: DeployQueue,
    private readonly teardownQueue: TeardownQueue,
    private readonly provisioning: ProvisioningService,
    private readonly validateLlmKey: ValidateLlmKeyService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateDeployDto): Promise<CreateDeployResponse> {
    // Re-validate the bot token (getMe) and enforce one active deploy per bot.
    // Throws 422 (invalid token) / 409 (already in use).
    const { username } = await this.validateBotToken.validate(dto.bot_token);

    const telegramId = BigInt(user.telegram_id);
    // Ensure the user row exists — FK: deploys.user_id → users.telegram_id.
    await this.prisma.user.upsert({
      where: { telegram_id: telegramId },
      create: { telegram_id: telegramId, username: user.username },
      update: {},
    });

    const deploy = await this.prisma.deploy.create({
      data: {
        user_id: telegramId,
        bot_token_enc: this.secrets.encrypt(dto.bot_token),
        bot_username: username,
        llm_provider: dto.llm_provider,
        llm_base_url: dto.llm_base_url ?? null,
        llm_model: dto.llm_model ?? null,
        llm_key_enc: this.secrets.encrypt(dto.llm_key),
      },
      select: { id: true },
    });

    await this.queue.enqueueDeploy({ deployId: deploy.id });
    this.logger.log(`Created deploy ${deploy.id} for @${username}`);

    return { deploy_id: deploy.id, status: 'pending' };
  }

  /** List the caller's deploys, newest first. Never returns secrets. */
  async list(user: AuthenticatedUser): Promise<DeployView[]> {
    const rows = await this.prisma.deploy.findMany({
      where: { user_id: BigInt(user.telegram_id) },
      orderBy: { created_at: 'desc' },
    });
    return rows.map(toDeployView);
  }

  /** Fetch one of the caller's deploys. 404 if missing or not owned. */
  async getById(user: AuthenticatedUser, id: string): Promise<DeployView> {
    const row = await this.findOwnedDeployOrThrow(id, user.telegram_id);
    return toDeployView(row);
  }

  /** Request teardown of an owned deploy. Idempotent; enqueues unless deleted. */
  async requestTeardown(user: AuthenticatedUser, id: string): Promise<DeployView> {
    const row = await this.findOwnedDeployOrThrow(id, user.telegram_id);
    if (row.status !== 'deleted') {
      await this.teardownQueue.enqueueTeardown({ deployId: id });
      this.logger.log(`Teardown requested for deploy ${id}`);
    }
    return toDeployView(row);
  }

  /** Restart the Hermes container of an owned, ready deploy. */
  async restart(user: AuthenticatedUser, id: string): Promise<RestartResponse> {
    const row = await this.findOwnedDeployOrThrow(id, user.telegram_id);
    if (row.status !== 'ready') {
      throw new ConflictException({ code: 'not_ready', message: 'Агент ещё не готов' });
    }
    const projectName = hermesProjectName(id);
    await this.provisioning.restartDockerProject(Number(row.hostinger_vm_id), projectName);
    await this.log(id, 'restart', 'success', `project ${projectName} restart requested`);
    this.logger.log(`Restart requested for deploy ${id}`);
    return { ok: true };
  }

  /**
   * Swap the LLM provider/key of an owned, ready deploy: probe the new key,
   * re-encrypt it, persist the new provider wiring, then re-push the Hermes
   * project so the container picks up the new .env. The key is never logged.
   */
  async updateLlmKey(
    user: AuthenticatedUser,
    id: string,
    dto: ValidateLlmKeyDto,
  ): Promise<UpdateLlmKeyResponse> {
    const row = await this.findOwnedDeployOrThrow(id, user.telegram_id);
    if (row.status !== 'ready') {
      throw new ConflictException({ code: 'not_ready', message: 'Агент ещё не готов' });
    }

    // Probe the key against the provider first — throws 422/502 on failure,
    // so an invalid key never touches the DB or the VM.
    await this.validateLlmKey.validate(dto);

    const provider = LLM_PROVIDERS.find((p) => p.id === dto.provider_id);
    if (!provider) {
      throw new NotFoundException('Deploy not found');
    }
    const newBaseUrl = dto.base_url ?? null;
    const newModel = dto.model ?? null;
    const effectiveBaseUrl = newBaseUrl ?? provider.base_url;
    const effectiveModel = newModel ?? provider.default_model;

    await this.prisma.deploy.update({
      where: { id },
      data: {
        llm_provider: dto.provider_id,
        llm_base_url: newBaseUrl,
        llm_model: newModel,
        llm_key_enc: this.secrets.encrypt(dto.api_key),
      },
    });

    const env = renderEnvFile({
      botToken: this.secrets.decrypt(row.bot_token_enc),
      allowedUserId: row.user_id.toString(),
      keyEnv: provider.key_env,
      llmKey: dto.api_key,
      baseUrl: effectiveBaseUrl,
    });
    const configYaml = renderConfigYaml({
      provider: provider.id,
      baseUrl: effectiveBaseUrl,
      keyEnv: provider.key_env,
      model: effectiveModel,
    });
    const compose = renderComposeFile({ configYaml });
    const projectName = hermesProjectName(id);
    await this.provisioning.updateDockerProject(
      Number(row.hostinger_vm_id),
      projectName,
      compose,
      env,
    );

    await this.log(id, 'update_llm_key', 'success', `provider ${dto.provider_id}`);
    this.logger.log(`LLM key updated for deploy ${id}`);
    return { ok: true };
  }

  /** Fetch a deploy row, enforcing ownership. 404 if missing or not owned. */
  private async findOwnedDeployOrThrow(id: string, telegramId: string): Promise<DeployRow> {
    const row = await this.prisma.deploy.findUnique({ where: { id } });
    if (!row || row.user_id !== BigInt(telegramId)) {
      throw new NotFoundException('Deploy not found');
    }
    return row as unknown as DeployRow;
  }

  private async log(
    deployId: string,
    step: string,
    status: string,
    message: string,
  ): Promise<void> {
    await this.prisma.provisioningLog.create({
      data: { deploy_id: deployId, step, status, message },
    });
  }
}

interface DeployRow {
  id: string;
  agent: string;
  bot_username: string;
  llm_provider: string;
  status: string;
  vm_ip: string | null;
  created_at: Date;
  updated_at: Date;
  user_id: bigint;
  hostinger_vm_id: string | null;
  bot_token_enc: string;
}

/** Project a Deploy row to its public, secret-free view. */
function toDeployView(d: DeployRow): DeployView {
  return {
    id: d.id,
    agent: d.agent,
    bot_username: d.bot_username,
    llm_provider: d.llm_provider,
    status: d.status as DeployStatus,
    vm_ip: d.vm_ip,
    created_at: d.created_at.toISOString(),
    updated_at: d.updated_at.toISOString(),
  };
}
