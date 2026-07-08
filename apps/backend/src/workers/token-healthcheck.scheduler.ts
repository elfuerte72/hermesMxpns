import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TokenHealthcheckService } from './token-healthcheck.service';

/** Hourly bot-token healthcheck (§23.8) — marks dead tokens `invalid` for the cabinet. */
@Injectable()
export class TokenHealthcheckScheduler {
  private readonly logger = new Logger(TokenHealthcheckScheduler.name);

  constructor(private readonly healthcheck: TokenHealthcheckService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    try {
      await this.healthcheck.checkOnce();
    } catch (err) {
      this.logger.error(`token healthcheck failed: ${String(err)}`);
    }
  }
}
