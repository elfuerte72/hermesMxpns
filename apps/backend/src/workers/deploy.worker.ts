import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { DEPLOY_QUEUE_NAME, parseRedisConnection, type DeployJobData } from '../deploys/deploy-queue';
import { DeployProcessor } from './deploy.processor';

/** BullMQ worker that consumes the `deploy` queue and runs the processor. */
@Injectable()
export class DeployWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeployWorker.name);
  private worker: Worker<DeployJobData> | null = null;

  constructor(
    private readonly redisUrl: string,
    private readonly processor: DeployProcessor,
    private readonly enabled: boolean,
  ) {}

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.warn('Deploy worker disabled (DEPLOY_WORKER_ENABLED=false).');
      return;
    }
    this.worker = new Worker<DeployJobData>(
      DEPLOY_QUEUE_NAME,
      (job) => this.processor.process(job.data.deployId, job.data.bootstrapToken),
      { connection: parseRedisConnection(this.redisUrl) },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`deploy job ${job?.id ?? '?'} failed: ${err.message}`);
    });
    this.logger.log('Deploy worker started.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
