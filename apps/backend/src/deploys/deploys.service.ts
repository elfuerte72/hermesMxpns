import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser, CreateDeployResponse } from '@hermes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SecretsService } from '../secrets/secrets.service';
import { ValidateBotTokenService } from './validate-bot-token.service';
import { DeployQueue } from './deploy-queue';
import { generateBootstrapToken } from './bootstrap-token';
import type { CreateDeployDto } from './create-deploy.dto';

@Injectable()
export class DeploysService {
  private readonly logger = new Logger(DeploysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly validateBotToken: ValidateBotTokenService,
    private readonly queue: DeployQueue,
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

    const { token, hash } = generateBootstrapToken();

    const deploy = await this.prisma.deploy.create({
      data: {
        user_id: telegramId,
        bot_token_enc: this.secrets.encrypt(dto.bot_token),
        bot_username: username,
        llm_provider: dto.llm_provider,
        llm_base_url: dto.llm_base_url ?? null,
        llm_model: dto.llm_model ?? null,
        llm_key_enc: this.secrets.encrypt(dto.llm_key),
        bootstrap_token_hash: hash,
      },
      select: { id: true },
    });

    // Plaintext bootstrap token travels only via the job payload (Redis, internal).
    await this.queue.enqueueDeploy({ deployId: deploy.id, bootstrapToken: token });
    this.logger.log(`Created deploy ${deploy.id} for @${username}`);

    return { deploy_id: deploy.id, status: 'pending' };
  }
}
