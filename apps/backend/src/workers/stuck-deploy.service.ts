import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { DeployNotifier } from './deploy-notifier';

export interface StuckDeployConfig {
  dryRun: boolean;
  /** Max time a deploy may sit in creating/configuring before it's failed. */
  timeoutMs: number;
}

/**
 * Watchdog for deploys wedged mid-provisioning — e.g. the worker crashed
 * between claiming and finishing. Fails them and rolls back any created
 * Hostinger resources so nothing is left orphaned.
 */
export class StuckDeployService {
  private readonly logger = new Logger(StuckDeployService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: ProvisioningService,
    private readonly notifier: DeployNotifier,
    private readonly config: StuckDeployConfig,
  ) {}

  async sweep(now: number = Date.now()): Promise<string[]> {
    const cutoff = new Date(now - this.config.timeoutMs);
    const stuck = await this.prisma.deploy.findMany({
      where: { status: { in: ['creating', 'configuring'] }, updated_at: { lt: cutoff } },
    });

    const failedIds: string[] = [];
    for (const deploy of stuck) {
      this.logger.warn(
        `Deploy ${deploy.id} stuck in ${deploy.status} since ${deploy.updated_at.toISOString()}; failing`,
      );

      if (!this.config.dryRun) {
        if (deploy.hostinger_vm_id) {
          await this.tryCleanup(deploy.id, 'timeout_vm', deploy.hostinger_vm_id, (id) =>
            this.provisioning.deleteVM(id),
          );
        }
      }

      await this.prisma.deploy.update({ where: { id: deploy.id }, data: { status: 'failed' } });
      await this.log(deploy.id, 'timeout', 'error', `stuck in ${deploy.status} past timeout`);
      try {
        await this.notifier.deployFailed(deploy.user_id, 'Provisioning timed out');
      } catch (err) {
        this.logger.error(`failed to notify user ${deploy.user_id}: ${String(err)}`);
      }
      failedIds.push(deploy.id);
    }
    return failedIds;
  }

  private async tryCleanup(
    deployId: string,
    step: string,
    resourceId: string,
    action: (id: number) => Promise<void>,
  ): Promise<void> {
    try {
      await action(Number(resourceId));
      await this.log(deployId, step, 'success', `deleted ${resourceId}`);
    } catch (err) {
      await this.log(deployId, step, 'error', `failed to delete ${resourceId}: ${String(err)}`);
    }
  }

  private async log(
    deployId: string,
    step: string,
    status: string,
    message: string,
  ): Promise<void> {
    await this.prisma.provisioningLog.create({
      data: { deploy_id: deployId, step, status, message },
    });
  }
}
