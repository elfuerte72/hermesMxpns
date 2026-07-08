import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SecretsService } from '../secrets/secrets.service';
import { ValidateBotTokenService } from '../deploys/validate-bot-token.service';

export interface TokenHealthcheckConfig {
  /** When true, skip live getMe probes (dev has fake encrypted tokens). */
  dryRun: boolean;
}

/**
 * Periodically probes the bot token of every ready deploy via `getMe` and marks
 * `bot_token_status` (§23.8): `invalid` when Telegram rejects the token (the bot
 * was deleted/revoked in @BotFather), `valid` otherwise. The cabinet surfaces
 * `invalid` as a red badge with a "change token" CTA. Token health is independent
 * of the VM `DeployStatus` — a dead token still leaves the VM running.
 */
@Injectable()
export class TokenHealthcheckService {
  private readonly logger = new Logger(TokenHealthcheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly validateBotToken: ValidateBotTokenService,
    private readonly config: TokenHealthcheckConfig,
  ) {}

  async checkOnce(): Promise<{ checked: number; invalidated: number }> {
    if (this.config.dryRun) {
      this.logger.log('DRY_RUN — token healthcheck skipped');
      return { checked: 0, invalidated: 0 };
    }

    const deploys = await this.prisma.deploy.findMany({
      where: { status: 'ready' },
      select: { id: true, bot_token_enc: true },
    });

    let invalidated = 0;
    for (const d of deploys) {
      const token = this.secrets.decrypt(d.bot_token_enc);
      const valid = await this.validateBotToken.isTokenValid(token);
      await this.prisma.deploy.update({
        where: { id: d.id },
        data: { bot_token_status: valid ? 'valid' : 'invalid' },
      });
      if (!valid) invalidated++;
    }

    this.logger.log(`token healthcheck: ${deploys.length} checked, ${invalidated} invalidated`);
    return { checked: deploys.length, invalidated };
  }
}
