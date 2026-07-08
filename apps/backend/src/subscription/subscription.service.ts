import { Injectable } from '@nestjs/common';
import {
  membershipStatusToSubscription,
  type AuthenticatedUser,
  type SubscriptionStatus,
  type SubscriptionStatusResponse,
} from '@hermes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { BotService } from '../bot/bot.service';

/**
 * Tribute subscription gating via the private "Hermes" channel membership
 * (architecture §23.2). The channel is managed by @tribute — membership is the
 * single source of truth for an active subscription. This service reads the
 * cached status from the user's deploys and, on demand, live-checks it via
 * `getChatMember` and mirrors the result onto every deploy of the caller.
 */
@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: BotService,
    private readonly channelId: bigint | null,
  ) {}

  /** Cached subscription status from the caller's most recent deploy. */
  async getStatus(user: AuthenticatedUser): Promise<SubscriptionStatusResponse> {
    const latest = await this.prisma.deploy.findFirst({
      where: { user_id: BigInt(user.telegram_id) },
      orderBy: { created_at: 'desc' },
      select: { subscription_status: true, subscription_until: true },
    });
    return {
      subscription_status: (latest?.subscription_status as SubscriptionStatus) ?? 'none',
      subscription_until: latest?.subscription_until?.toISOString() ?? null,
    };
  }

  /**
   * Live-check membership in the "Hermes" channel and mirror it onto every
   * deploy of the caller. Called after the user returns from paying in @tribute.
   * Returns 'none' when subscription gating is not configured (no channel id).
   */
  async checkStatus(user: AuthenticatedUser): Promise<SubscriptionStatusResponse> {
    const status = await this.fetchMembershipStatus(user.telegram_id);
    if (this.channelId != null) {
      await this.prisma.deploy.updateMany({
        where: { user_id: BigInt(user.telegram_id) },
        data: {
          subscription_status: status,
          subscription_channel_id: this.channelId,
          subscription_expired_at: status === 'expired' ? new Date() : null,
        },
      });
    }
    return { subscription_status: status, subscription_until: null };
  }

  /**
   * Live membership status without the DB write — used by the deploy gate to
   * decide whether the caller may create a one-click agent (must be `active`).
   */
  async getLiveStatus(user: AuthenticatedUser): Promise<SubscriptionStatus> {
    return this.fetchMembershipStatus(user.telegram_id);
  }

  /** Whether subscription gating is enabled (a channel id is configured). */
  isGatingEnabled(): boolean {
    return this.channelId != null;
  }

  private async fetchMembershipStatus(telegramId: string): Promise<SubscriptionStatus> {
    if (this.channelId == null) return 'none';
    const member = await this.bot.getChatMember(this.channelId, BigInt(telegramId));
    if (!member) return 'none';
    return membershipStatusToSubscription(member.status);
  }
}
