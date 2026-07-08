import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SubscriptionExpiryService } from './subscription-expiry.service';

/** Daily grace-teardown sweep (§23.9) for lapsed subscriptions past the grace window. */
@Injectable()
export class SubscriptionExpiryScheduler {
  private readonly logger = new Logger(SubscriptionExpiryScheduler.name);

  constructor(private readonly expiry: SubscriptionExpiryService) {}

  @Cron('0 0 4 * * *')
  async run(): Promise<void> {
    try {
      await this.expiry.checkOnce();
    } catch (err) {
      this.logger.error(`subscription expiry sweep failed: ${String(err)}`);
    }
  }
}
