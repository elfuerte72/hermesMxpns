import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import {
  membershipStatusToSubscription,
  type AuthenticatedUser,
  type TopupResponse,
  type TopupTier,
  type TopupTierView,
} from '@hermes/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OpenRouterKeysService } from '../../openrouter-keys/openrouter-keys.service';
import { BotService } from '../../bot/bot.service';

const tierSchema = z.object({
  amount_usd: z.number().positive(),
  channel_id: z.string().min(1),
  subscribe_url: z.string().min(1),
});

/** Parse the TOPUP_TIERS env (JSON array) into validated tiers. Throws on invalid. */
export function parseTopupTiers(raw: string | undefined): TopupTier[] {
  if (!raw || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('TOPUP_TIERS is not valid JSON');
  }
  const result = z.array(tierSchema).safeParse(parsed);
  if (!result.success) {
    throw new Error(`TOPUP_TIERS invalid: ${result.error.issues.map((i) => i.message).join(', ')}`);
  }
  return result.data;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * One-click token topup (§23.5, §23.9 step 5). The user subscribes to a fixed
 * Tribute tier channel (managed by @tribute) for a given USD amount; membership
 * is verified via `getChatMember` before the OpenRouter key's spend cap is
 * raised by that amount. The +markup is realised in the Tribute channel price,
 * not in the cap raise — `amount_usd` is the token value added.
 */
@Injectable()
export class TopupService {
  private readonly logger = new Logger(TopupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openRouterKeys: OpenRouterKeysService,
    private readonly bot: BotService,
    private readonly tiers: TopupTier[],
    private readonly markupPercent: number,
  ) {}

  listTiers(): TopupTierView[] {
    const factor = 1 + this.markupPercent / 100;
    return this.tiers
      .map((t) => ({
        amount_usd: t.amount_usd,
        price_usd: round2(t.amount_usd * factor),
        subscribe_url: t.subscribe_url,
      }))
      .sort((a, b) => a.amount_usd - b.amount_usd);
  }

  async topup(
    user: AuthenticatedUser,
    dto: { deploy_id: string; amount_usd: number },
  ): Promise<TopupResponse> {
    const deploy = await this.prisma.deploy.findUnique({ where: { id: dto.deploy_id } });
    if (!deploy || deploy.user_id !== BigInt(user.telegram_id)) {
      throw new NotFoundException('Deploy not found');
    }
    if (deploy.status !== 'ready') {
      throw new ConflictException({ code: 'not_ready', message: 'Агент ещё не готов' });
    }
    if (!deploy.openrouter_key_hash) {
      throw new BadRequestException('У этого агента нет управляемого ключа для пополнения');
    }
    const tier = this.tiers.find((t) => t.amount_usd === dto.amount_usd);
    if (!tier) {
      throw new BadRequestException('Неизвестный тариф доплаты');
    }

    // Verify the user paid for this tier by checking its channel membership.
    const member = await this.bot.getChatMember(BigInt(tier.channel_id), BigInt(user.telegram_id));
    if (!member || membershipStatusToSubscription(member.status) !== 'active') {
      throw new HttpException(
        { code: 'topup_required', message: 'Подписка на тариф доплаты не активна' },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const key = await this.openRouterKeys.getKey(deploy.openrouter_key_hash);
    const newLimit = round2((key.limit ?? 0) + dto.amount_usd);
    await this.openRouterKeys.raiseLimit(deploy.openrouter_key_hash, newLimit);
    await this.prisma.provisioningLog.create({
      data: {
        deploy_id: dto.deploy_id,
        step: 'topup',
        status: 'success',
        message: `+$${dto.amount_usd} → $${newLimit}`,
      },
    });
    this.logger.log(`topup deploy ${dto.deploy_id}: +$${dto.amount_usd} → $${newLimit}`);
    return { ok: true, new_limit_usd: newLimit };
  }
}
