import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedUser } from '@hermes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TmaValidationError, validateInitData } from './tma-validation';

export const DEFAULT_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly botToken: string,
    private readonly maxAgeSeconds: number = DEFAULT_AUTH_MAX_AGE_SECONDS,
  ) {}

  authenticate(initData: string, now: number = Date.now()): AuthenticatedUser {
    try {
      const validated = validateInitData(initData, {
        botToken: this.botToken,
        now,
        maxAgeSeconds: this.maxAgeSeconds,
      });
      return { telegram_id: validated.telegramId, username: validated.username };
    } catch (err) {
      if (err instanceof TmaValidationError) {
        throw new UnauthorizedException({ code: err.code, message: err.message });
      }
      throw new UnauthorizedException('Invalid Telegram initData');
    }
  }

  async validateInitAndUpsert(initData: string, now: number = Date.now()): Promise<AuthenticatedUser> {
    const user = this.authenticate(initData, now);
    await this.prisma.user.upsert({
      where: { telegram_id: BigInt(user.telegram_id) },
      create: { telegram_id: BigInt(user.telegram_id), username: user.username },
      update: { username: user.username },
    });
    return user;
  }
}
