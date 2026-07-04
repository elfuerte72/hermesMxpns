import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { parseRedisConnection } from './deploy-queue';

export const TEARDOWN_QUEUE_NAME = 'teardown';
export const TEARDOWN_JOB_NAME = 'teardown';

export interface TeardownJobData {
  deployId: string;
}

/** Port for enqueueing teardown jobs; tests inject a fake without Redis. */
export abstract class TeardownQueue {
  abstract enqueueTeardown(data: TeardownJobData): Promise<void>;
}

/** BullMQ-backed teardown queue. jobId keyed on deployId for idempotency. */
export class BullTeardownQueue extends TeardownQueue implements OnModuleDestroy {
  private readonly logger = new Logger(BullTeardownQueue.name);
  private readonly queue: Queue;

  constructor(redisUrl: string) {
    super();
    this.queue = new Queue(TEARDOWN_QUEUE_NAME, { connection: parseRedisConnection(redisUrl) });
  }

  async enqueueTeardown(data: TeardownJobData): Promise<void> {
    await this.queue.add(TEARDOWN_JOB_NAME, data, {
      jobId: `teardown-${data.deployId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
    this.logger.log(`Enqueued teardown job ${data.deployId}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
