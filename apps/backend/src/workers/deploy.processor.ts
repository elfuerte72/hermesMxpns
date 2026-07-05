import { Logger } from '@nestjs/common';
import { LLM_PROVIDERS, type HostingerVirtualMachine } from '@hermes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { SecretsService } from '../secrets/secrets.service';
import { renderComposeFile, renderConfigYaml, renderEnvFile } from '../provisioning/hermes-config';
import { errorStatus, withRetry, type RetryOptions } from '../common/retry';
import { DeployNotifier } from './deploy-notifier';

// Boundary-fixed provisioning parameters (do not change — see AGENTS.md).
export const HERMES_ITEM_ID = 'hostingercom-vps-kvm1-usd-1m';
export const HERMES_TEMPLATE_ID = 1121;
export const HERMES_DATA_CENTER_ID = 11;

export function hermesProjectName(deployId: string): string {
  return `hermes-${deployId}`;
}

export interface DeployProcessorConfig {
  /** When true, skip all real (money-spending) Hostinger calls. */
  dryRun: boolean;
  pollIntervalMs: number;
  pollMaxAttempts: number;
  /** Retries for transient (429/5xx/network) Hostinger errors. Default 3. */
  retries?: number;
  /** Base backoff for those retries. Default 2000ms. */
  retryBaseDelayMs?: number;
  /** Injectable delay (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Core deploy provisioning logic — the BullMQ `deploy` job body, extracted so it
 * is unit-testable with a mocked Hostinger SDK. State machine:
 * pending → creating → configuring → ready (or failed on error). Secrets are
 * decrypted here and delivered straight to the VPS via the Docker Manager API —
 * no post-install script, no bootstrap pull, no webhook.
 */
export class DeployProcessor {
  private readonly logger = new Logger(DeployProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: ProvisioningService,
    private readonly secrets: SecretsService,
    private readonly notifier: DeployNotifier,
    private readonly config: DeployProcessorConfig,
  ) {}

  async process(deployId: string): Promise<void> {
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

    let vmId: number | undefined;
    try {
      // 1. Purchase the VM. SPENDS REAL MONEY (guarded by DRY_RUN above); never retried.
      const purchase = await this.provisioning.purchaseVM({
        itemId: HERMES_ITEM_ID,
        setup: { templateId: HERMES_TEMPLATE_ID, dataCenterId: HERMES_DATA_CENTER_ID },
      });
      vmId = purchase.virtualMachine.id;
      await this.prisma.deploy.update({
        where: { id: deployId },
        data: { hostinger_vm_id: String(vmId) },
      });
      await this.log(deployId, 'purchase_vm', 'success', `vm ${vmId}`);

      // 2. Poll until the VM is running, record its IP, move to configuring.
      const vm = await this.waitForVm(vmId);
      const ip = vm.ipv4[0] ?? null;
      await this.prisma.deploy.update({
        where: { id: deployId },
        data: { vm_ip: ip, status: 'configuring' },
      });
      await this.log(deployId, 'vm_running', 'success', `ip ${ip ?? 'unknown'}`);

      // 3. Push the Hermes compose project (secrets in the project .env) to the VM.
      const provider = LLM_PROVIDERS.find((p) => p.id === deploy.llm_provider);
      if (!provider) {
        throw new Error(`Unknown LLM provider "${deploy.llm_provider}"`);
      }
      const env = renderEnvFile({
        botToken: this.secrets.decrypt(deploy.bot_token_enc),
        allowedUserId: deploy.user_id.toString(),
        keyEnv: provider.key_env,
        llmKey: this.secrets.decrypt(deploy.llm_key_enc),
      });
      const configYaml = renderConfigYaml({
        provider: provider.id,
        baseUrl: deploy.llm_base_url ?? provider.base_url,
        keyEnv: provider.key_env,
        model: deploy.llm_model ?? provider.default_model,
      });
      const compose = renderComposeFile({ configYaml });
      const projectName = hermesProjectName(deployId);
      const vmIdFinal = vmId;
      await withRetry(
        () => this.provisioning.createDockerProject(vmIdFinal, projectName, compose, env),
        this.retryOpts(),
      );
      await this.log(deployId, 'create_project', 'success', `project ${projectName}`);

      // 4. Poll until a project container is running, then flip to ready.
      await this.waitForContainer(vmId, projectName);
      const readied = await this.prisma.deploy.updateMany({
        where: { id: deployId, status: 'configuring' },
        data: { status: 'ready' },
      });
      if (readied.count !== 1) {
        this.logger.warn(`deploy ${deployId} no longer configuring; not marking ready`);
        return;
      }
      await this.log(deployId, 'ready', 'success', 'hermes container running');

      try {
        await this.notifier.deployReady(deploy.user_id, deploy.bot_username);
      } catch (notifyErr) {
        this.logger.error(`failed to notify user ${deploy.user_id}: ${String(notifyErr)}`);
      }
      this.logger.log(`deploy ${deployId} is ready (@${deploy.bot_username})`);
    } catch (err) {
      await this.fail(deployId, deploy.user_id, vmId, err);
    }
  }

  private async waitForVm(vmId: number): Promise<HostingerVirtualMachine> {
    const sleep = this.config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    for (let attempt = 1; attempt <= this.config.pollMaxAttempts; attempt++) {
      // getVM retries transient (429/5xx/network) errors so a blip doesn't fail
      // the whole deploy; a non-transient error still propagates.
      const vm = await withRetry(() => this.provisioning.getVM(vmId), this.retryOpts());
      if (vm.state === 'running') return vm;
      if (vm.state === 'error') throw new Error(`VM ${vmId} entered an error state`);
      if (attempt < this.config.pollMaxAttempts) await sleep(this.config.pollIntervalMs);
    }
    throw new Error(`Timed out waiting for VM ${vmId} to run`);
  }

  private async waitForContainer(vmId: number, projectName: string): Promise<void> {
    const sleep = this.config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    for (let attempt = 1; attempt <= this.config.pollMaxAttempts; attempt++) {
      const containers = await this.getContainersOrNull(vmId, projectName);
      if (containers) {
        if (containers.some((c) => c.state === 'running')) return;
        if (containers.some((c) => c.state === 'exited' || c.state === 'dead')) {
          throw new Error(`Container in project ${projectName} exited before becoming ready`);
        }
      }
      if (attempt < this.config.pollMaxAttempts) await sleep(this.config.pollIntervalMs);
    }
    throw new Error(`Timed out waiting for a running container in project ${projectName}`);
  }

  private async getContainersOrNull(vmId: number, projectName: string) {
    try {
      return await withRetry(
        () => this.provisioning.getDockerProjectContainers(vmId, projectName),
        this.retryOpts(),
      );
    } catch (err) {
      // The project may not be visible yet right after createNewProjectV1
      // (async action) — keep polling instead of failing the deploy.
      if (errorStatus(err) === 404 || errorStatus(err) === 422) return null;
      throw err;
    }
  }

  private retryOpts(): RetryOptions {
    return {
      retries: this.config.retries ?? 3,
      baseDelayMs: this.config.retryBaseDelayMs ?? 2000,
      sleep: this.config.sleep,
    };
  }

  /** Roll back the created VM so a failed deploy never leaves an orphan. */
  private async fail(
    deployId: string,
    telegramId: bigint,
    vmId: number | undefined,
    err: unknown,
  ): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    this.logger.error(`deploy ${deployId} failed: ${reason}`);
    await this.log(deployId, 'error', 'error', reason);

    if (vmId !== undefined) {
      await this.tryCleanup(deployId, 'cleanup_vm', vmId, () =>
        withRetry(() => this.provisioning.deleteVM(vmId), this.retryOpts()),
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
