import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StuckDeployService } from './stuck-deploy.service';

/** Runs the stuck-deploy watchdog every 5 minutes. */
@Injectable()
export class StuckDeployScheduler {
  private readonly logger = new Logger(StuckDeployScheduler.name);

  constructor(private readonly stuckDeployService: StuckDeployService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    try {
      await this.stuckDeployService.sweep();
    } catch (err) {
      this.logger.error(`Stuck-deploy sweep failed: ${String(err)}`);
    }
  }
}
