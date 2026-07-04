import { Logger } from '@nestjs/common';
import type { HostingerVirtualMachine } from '@hermes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { generatePostInstallScript } from '../provisioning/script-generator';
import { DeployNotifier } from './deploy-notifier';

// Boundary-fixed provisioning parameters (do not change — see AGENTS.md).
export const HERMES_ITEM_ID = 'hostingercom-vps-kvm1-usd-1m';
export const HERMES_TEMPLATE_ID = 1121;
export const HERMES_DATA_CENTER_ID = 11;

export interface DeployProcessorConfig {
  backendUrl: string;
  /** When true, skip all real (money-spending) Hostinger calls. */
  dryRun: boolean;
  pollIntervalMs: number;
  pollMaxAttempts: number;
  /** Injectable delay (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Core deploy provisioning logic — the BullMQ `deploy` job body, extracted so it
 * is unit-testable with a mocked Hostinger SDK. State machine:
 * pending → creating → configuring → (ready via webhook / failed on error).
 * The worker's job ends at `configuring` with the VM running; the VPS itself
 * flips the deploy to `ready` via POST /webhooks/deploy-ready (Task 13).
 */
export class DeployProcessor {
  private readonly logger = new Logger(DeployProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: ProvisioningService,
    private readonly notifier: DeployNotifier,
    private readonly config: DeployProcessorConfig,
  ) {}

  async process(deployId: string, bootstrapToken: string): Promise<void> {
    const deploy = await this.prisma.deploy.findUnique({ where: { id: deployId } });
    if (!deploy) {
      this.logger.warn(`deploy ${deployId} not found; skipping`);
      return;
    }

    if (this.config.dryRun) {
      this.logger.warn(`DRY_RUN active — not provisioning deploy ${deployId}`);
      await this.log(deployId, 'dry_run', 'skipped', 'DRY_RUN — provisioning skipped');
      return;
    }

    // Idempotent claim: only the transition from `pending` may proceed.
    const claimed = await this.prisma.deploy.updateMany({
      where: { id: deployId, status: 'pending' },
      data: { status: 'creating' },
    });
    if (claimed.count !== 1) {
      this.logger.log(`deploy ${deployId} not pending (already handled); skipping`);
      return;
    }
    await this.log(deployId, 'claim', 'success', 'pending → creating');

    let scriptId: number | undefined;
    let vmId: number | undefined;
    try {
      // 1. Create the post-install script (no secrets — bootstrap URL only).
      const content = generatePostInstallScript({
        backendUrl: this.config.backendUrl,
        deployId,
        bootstrapToken,
      });
      const script = await this.provisioning.createPostInstallScript(`hermes-${deployId}`, content);
      scriptId = script.id;
      await this.prisma.deploy.update({
        where: { id: deployId },
        data: { hostinger_script_id: String(scriptId) },
      });
      await this.log(deployId, 'create_script', 'success', `script ${scriptId}`);

      // 2. Purchase + set up the VM. SPENDS REAL MONEY (guarded by DRY_RUN above).
      const purchase = await this.provisioning.purchaseVM({
        itemId: HERMES_ITEM_ID,
        setup: {
          templateId: HERMES_TEMPLATE_ID,
          dataCenterId: HERMES_DATA_CENTER_ID,
          postInstallScriptId: scriptId,
        },
      });
      vmId = purchase.virtualMachine.id;
      await this.prisma.deploy.update({
        where: { id: deployId },
        data: { hostinger_vm_id: String(vmId), status: 'configuring' },
      });
      await this.log(deployId, 'purchase_vm', 'success', `vm ${vmId}`);

      // 3. Poll until the VM is running, then record its IP for the bootstrap check.
      const vm = await this.waitForVm(vmId);
      const ip = vm.ipv4[0] ?? null;
      await this.prisma.deploy.update({ where: { id: deployId }, data: { vm_ip: ip } });
      await this.log(deployId, 'vm_running', 'success', `ip ${ip ?? 'unknown'}`);

      this.logger.log(`deploy ${deployId} provisioned (vm ${vmId}); awaiting bootstrap`);
    } catch (err) {
      await this.fail(deployId, deploy.user_id, scriptId, vmId, err);
    }
  }

  private async waitForVm(vmId: number): Promise<HostingerVirtualMachine> {
    const sleep = this.config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    for (let attempt = 1; attempt <= this.config.pollMaxAttempts; attempt++) {
      const vm = await this.provisioning.getVM(vmId);
      if (vm.state === 'running') return vm;
      if (vm.state === 'error') throw new Error(`VM ${vmId} entered an error state`);
      if (attempt < this.config.pollMaxAttempts) await sleep(this.config.pollIntervalMs);
    }
    throw new Error(`Timed out waiting for VM ${vmId} to run`);
  }

  /** Roll back created resources so a failed deploy never leaves an orphan. */
  private async fail(
    deployId: string,
    telegramId: bigint,
    scriptId: number | undefined,
    vmId: number | undefined,
    err: unknown,
  ): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    this.logger.error(`deploy ${deployId} failed: ${reason}`);
    await this.log(deployId, 'error', 'error', reason);

    if (vmId !== undefined) {
      await this.tryCleanup(deployId, 'cleanup_vm', vmId, () => this.provisioning.deleteVM(vmId));
    }
    if (scriptId !== undefined) {
      await this.tryCleanup(deployId, 'cleanup_script', scriptId, () =>
        this.provisioning.deletePostInstallScript(scriptId),
      );
    }

    await this.prisma.deploy.update({ where: { id: deployId }, data: { status: 'failed' } });
    try {
      await this.notifier.deployFailed(telegramId, reason);
    } catch (notifyErr) {
      this.logger.error(`failed to notify user ${telegramId}: ${String(notifyErr)}`);
    }
  }

  private async tryCleanup(
    deployId: string,
    step: string,
    resourceId: number,
    action: () => Promise<void>,
  ): Promise<void> {
    try {
      await action();
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
