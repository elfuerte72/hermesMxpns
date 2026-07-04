import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import {
  TEARDOWN_QUEUE_NAME,
  type TeardownJobData,
} from '../deploys/teardown-queue';
import { parseRedisConnection } from '../deploys/deploy-queue';
import { TeardownProcessor } from './teardown.processor';

/** BullMQ worker that consumes the `teardown` queue. */
@Injectable()
export class TeardownWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TeardownWorker.name);
  private worker: Worker<TeardownJobData> | null = null;

  constructor(
    private readonly redisUrl: string,
    private readonly processor: TeardownProcessor,
    private readonly enabled: boolean,
  ) {}

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.warn('Teardown worker disabled (DEPLOY_WORKER_ENABLED=false).');
      return;
    }
    this.worker = new Worker<TeardownJobData>(
      TEARDOWN_QUEUE_NAME,
      (job) => this.processor.process(job.data.deployId),
      { connection: parseRedisConnection(this.redisUrl) },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`teardown job ${job?.id ?? '?'} failed: ${err.message}`);
    });
    this.logger.log('Teardown worker started.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
