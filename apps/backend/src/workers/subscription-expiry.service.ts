import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TeardownQueue } from '../deploys/teardown-queue';

export interface SubscriptionExpiryConfig {
  /** Days an expired subscription is kept (agent frozen) before auto-teardown. */
  graceDays: number;
  /** When true, skip scheduling teardowns (dev). */
  dryRun: boolean;
}

/**
 * Grace-teardown (§23.9 step 6): a subscription that lapsed (`subscription_status
 * = 'expired'`) is kept frozen (key disabled) for a grace window so the user can
 * renew. Past the grace window the agent is torn down — the VM and the managed
 * OpenRouter key are deleted. Renewal within grace re-enables the key and clears
 * `subscription_expired_at`, so the deploy is never seen here.
 */
@Injectable()
export class SubscriptionExpiryService {
  private readonly logger = new Logger(SubscriptionExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly teardownQueue: TeardownQueue,
    private readonly config: SubscriptionExpiryConfig,
  ) {}

  async checkOnce(): Promise<{ scheduled: number }> {
    if (this.config.dryRun) {
      this.logger.log('DRY_RUN — subscription expiry teardown skipped');
      return { scheduled: 0 };
    }
    if (this.config.graceDays <= 0) return { scheduled: 0 };

    const cutoff = new Date(Date.now() - this.config.graceDays * 86_400_000);
    const expired = await this.prisma.deploy.findMany({
      where: {
        subscription_status: 'expired',
        subscription_expired_at: { lt: cutoff },
        status: { not: 'deleted' },
      },
      select: { id: true },
    });

    for (const d of expired) {
      await this.teardownQueue.enqueueTeardown({ deployId: d.id });
    }

    if (expired.length > 0) {
      this.logger.log(`subscription expiry: scheduled teardown for ${expired.length} deploy(s)`);
    }
    return { scheduled: expired.length };
  }
}
