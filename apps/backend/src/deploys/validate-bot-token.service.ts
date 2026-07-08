import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import axios from 'axios';
import type { ValidateBotTokenResponse } from '@hermes/shared';
import { PrismaService } from '../prisma/prisma.service';

export const TELEGRAM_API_BASE = 'https://api.telegram.org';
export const ACTIVE_DEPLOY_STATUSES = ['pending', 'creating', 'configuring', 'ready'] as const;

interface TelegramGetMeResponse {
  ok: boolean;
  result?: { id: number; username: string; first_name: string; is_bot: boolean };
}

@Injectable()
export class ValidateBotTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramApiBase: string = TELEGRAM_API_BASE,
  ) {}

  async validate(botToken: string, excludeDeployId?: string): Promise<ValidateBotTokenResponse> {
    const me = await this.callGetMe(botToken);
    await this.assertNotInUse(me.username, excludeDeployId);
    return { username: me.username, id: me.id };
  }

  /** Whether the token still resolves to a live bot (getMe 200). No uniqueness check. */
  async isTokenValid(botToken: string): Promise<boolean> {
    try {
      const me = await this.callGetMe(botToken);
      return Boolean(me.username);
    } catch {
      return false;
    }
  }

  private async callGetMe(botToken: string): Promise<{ id: number; username: string }> {
    let res: { data: TelegramGetMeResponse };
    try {
      res = await axios.get<TelegramGetMeResponse>(`${this.telegramApiBase}/bot${botToken}/getMe`);
    } catch {
      throw new UnprocessableEntityException('Invalid Telegram bot token');
    }

    if (!res.data?.ok || !res.data.result?.username) {
      throw new UnprocessableEntityException('Invalid Telegram bot token');
    }
    const { id, username, is_bot } = res.data.result;
    if (!is_bot) {
      throw new UnprocessableEntityException('Token does not belong to a bot account');
    }
    return { id, username };
  }

  private async assertNotInUse(username: string, excludeDeployId?: string): Promise<void> {
    const existing = await this.prisma.deploy.findFirst({
      where: {
        bot_username: username,
        status: { in: [...ACTIVE_DEPLOY_STATUSES] },
        ...(excludeDeployId ? { id: { not: excludeDeployId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`Bot @${username} is already used by an active deploy`);
    }
  }
}
