import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { DeployNotifier } from './deploy-notifier';
import { ACTIVE_DEPLOY_STATUSES } from './deploy.processor';

export interface TeardownProcessorConfig {
  /** When true, skip real Hostinger deletions (dev has no real resources). */
  dryRun: boolean;
}

/**
 * BullMQ `teardown` job body — deletes the VM and marks the deploy `deleted`.
 * Idempotent: a repeat run on an already-deleted deploy is a no-op; cleanup
 * errors are swallowed (best-effort).
 */
export class TeardownProcessor {
  private readonly logger = new Logger(TeardownProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: ProvisioningService,
    private readonly notifier: DeployNotifier,
    private readonly config: TeardownProcessorConfig,
  ) {}

  async process(deployId: string): Promise<void> {
    const deploy = await this.prisma.deploy.findUnique({ where: { id: deployId } });
    if (!deploy) {
      this.logger.warn(`teardown: deploy ${deployId} not found; skipping`);
      return;
    }
    if (deploy.status === 'deleted') {
      this.logger.log(`teardown: deploy ${deployId} already deleted; skipping`);
      return;
    }

    if (this.config.dryRun) {
      await this.log(deployId, 'dry_run', 'skipped', 'DRY_RUN — teardown skipped');
    } else if (deploy.hostinger_vm_id) {
      // Never delete a VM another active deploy still relies on — a shared
      // machine (e.g. an orphan adopted by a later successful deploy) must
      // survive teardown of the deploy that no longer owns it.
      const sharedBy = await this.prisma.deploy.count({
        where: {
          hostinger_vm_id: deploy.hostinger_vm_id,
          id: { not: deployId },
          status: { in: [...ACTIVE_DEPLOY_STATUSES] },
        },
      });
      if (sharedBy > 0) {
        await this.log(
          deployId,
          'teardown_vm',
          'skipped',
          `kept vm ${deploy.hostinger_vm_id} — still used by ${sharedBy} active deploy(s)`,
        );
      } else {
        await this.tryCleanup(deployId, 'teardown_vm', deploy.hostinger_vm_id, (id) =>
          this.provisioning.deleteVM(id),
        );
      }
    }

    await this.prisma.deploy.update({ where: { id: deployId }, data: { status: 'deleted' } });
    await this.log(deployId, 'deleted', 'success', 'deploy torn down');

    try {
      await this.notifier.deployDeleted(deploy.user_id, deploy.bot_username);
    } catch (err) {
      this.logger.error(`failed to notify user ${deploy.user_id}: ${String(err)}`);
    }
    this.logger.log(`deploy ${deployId} torn down`);
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
