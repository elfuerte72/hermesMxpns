import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  AuthenticatedUser,
  CreateDeployResponse,
  DeployStatus,
  DeployView,
} from '@hermes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SecretsService } from '../secrets/secrets.service';
import { ValidateBotTokenService } from './validate-bot-token.service';
import { DeployQueue } from './deploy-queue';
import { TeardownQueue } from './teardown-queue';
import type { CreateDeployDto } from './create-deploy.dto';

@Injectable()
export class DeploysService {
  private readonly logger = new Logger(DeploysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly validateBotToken: ValidateBotTokenService,
    private readonly queue: DeployQueue,
    private readonly teardownQueue: TeardownQueue,
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
    const row = await this.prisma.deploy.findUnique({ where: { id } });
    if (!row || row.user_id !== BigInt(user.telegram_id)) {
      throw new NotFoundException('Deploy not found');
    }
    return toDeployView(row);
  }

  /** Request teardown of an owned deploy. Idempotent; enqueues unless deleted. */
  async requestTeardown(user: AuthenticatedUser, id: string): Promise<DeployView> {
    const row = await this.prisma.deploy.findUnique({ where: { id } });
    if (!row || row.user_id !== BigInt(user.telegram_id)) {
      throw new NotFoundException('Deploy not found');
    }
    if (row.status !== 'deleted') {
      await this.teardownQueue.enqueueTeardown({ deployId: id });
      this.logger.log(`Teardown requested for deploy ${id}`);
    }
    return toDeployView(row);
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
