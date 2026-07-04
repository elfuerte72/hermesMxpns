import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { DeployReadyResponse } from '@hermes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { DeployNotifier } from '../workers/deploy-notifier';
import { bootstrapTokenMatches } from '../deploys/bootstrap-token';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: ProvisioningService,
    private readonly notifier: DeployNotifier,
    private readonly dryRun: boolean,
  ) {}

  /**
   * Called by the VPS after Hermes is up. Verifies the one-time webhook secret
   * (hash), flips the deploy to `ready`, cleans up the post-install script,
   * and DMs the client. Idempotent for repeats.
   */
  async deployReady(deployId: string, secret: string): Promise<DeployReadyResponse> {
    const deploy = await this.prisma.deploy.findUnique({ where: { id: deployId } });
    if (
      !deploy ||
      !deploy.webhook_secret_hash ||
      !secret ||
      !bootstrapTokenMatches(secret, deploy.webhook_secret_hash)
    ) {
      throw new NotFoundException('Unknown deploy or invalid webhook signature');
    }

    // Idempotent: a repeat webhook for an already-ready deploy is a no-op 200.
    if (deploy.status === 'ready') {
      return { status: 'ready' };
    }

    // Only a deploy still being provisioned may transition to ready.
    const updated = await this.prisma.deploy.updateMany({
      where: { id: deployId, status: { in: ['creating', 'configuring'] } },
      data: { status: 'ready' },
    });
    if (updated.count !== 1) {
      const current = await this.prisma.deploy.findUnique({
        where: { id: deployId },
        select: { status: true },
      });
      if (current?.status === 'ready') return { status: 'ready' };
      throw new NotFoundException('Deploy is not awaiting readiness');
    }
    await this.log(deployId, 'ready', 'success', 'VPS reported deploy ready');

    // Hygiene: drop the account-visible post-install script (best-effort).
    if (deploy.hostinger_script_id && !this.dryRun) {
      try {
        await this.provisioning.deletePostInstallScript(Number(deploy.hostinger_script_id));
        await this.log(deployId, 'cleanup_script', 'success', 'post-install script deleted');
      } catch (err) {
        await this.log(deployId, 'cleanup_script', 'error', String(err));
      }
    }

    try {
      await this.notifier.deployReady(deploy.user_id, deploy.bot_username);
    } catch (err) {
      this.logger.error(`failed to notify user ${deploy.user_id}: ${String(err)}`);
    }

    this.logger.log(`deploy ${deployId} is ready (@${deploy.bot_username})`);
    return { status: 'ready' };
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
