import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReconcileService } from './reconcile.service';

/** Fires the reconciliation once a day. Logic lives in ReconcileService. */
@Injectable()
export class ReconcileScheduler {
  private readonly logger = new Logger(ReconcileScheduler.name);

  constructor(private readonly reconcileService: ReconcileService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    try {
      await this.reconcileService.reconcile();
    } catch (err) {
      this.logger.error(`Reconcile run failed: ${String(err)}`);
    }
  }
}
