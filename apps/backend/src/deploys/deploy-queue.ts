import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, type ConnectionOptions } from 'bullmq';

export const DEPLOY_QUEUE_NAME = 'deploy';
export const DEPLOY_JOB_NAME = 'deploy';

/** Payload handed to the provisioning worker (Task 12). */
export interface DeployJobData {
  deployId: string;
}

/**
 * Port for enqueueing provisioning jobs. Services depend on this abstraction so
 * tests can inject a fake without a running Redis.
 */
export abstract class DeployQueue {
  abstract enqueueDeploy(data: DeployJobData): Promise<void>;
}

/**
 * Parse a `redis://` URL into BullMQ connection options. We pass options (not an
 * ioredis instance) so BullMQ uses its own bundled ioredis and avoids a
 * dual-package type conflict.
 */
export function parseRedisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    // Required by BullMQ for its blocking connections.
    maxRetriesPerRequest: null,
  };
}

/** BullMQ-backed queue. One job per deploy; `jobId` = deployId for idempotency. */
export class BullDeployQueue extends DeployQueue implements OnModuleDestroy {
  private readonly logger = new Logger(BullDeployQueue.name);
  private readonly queue: Queue;

  constructor(redisUrl: string) {
    super();
    this.queue = new Queue(DEPLOY_QUEUE_NAME, { connection: parseRedisConnection(redisUrl) });
  }

  async enqueueDeploy(data: DeployJobData): Promise<void> {
    await this.queue.add(DEPLOY_JOB_NAME, data, {
      jobId: data.deployId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
    this.logger.log(`Enqueued deploy job ${data.deployId}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
