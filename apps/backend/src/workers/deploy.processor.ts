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

/** Watch for a VM Hostinger creates after a 402 purchase: every 15s for ~3 min. */
const LATE_VM_POLL_INTERVAL_MS = 15_000;
const LATE_VM_POLL_MAX_ATTEMPTS = 12;
/** Clock-skew slack when matching a late VM's created_at against purchase start. */
const LATE_VM_CREATED_AT_SLACK_MS = 60_000;
/** Only adopt a pre-existing paid VM if it was created within this window. */
const ADOPTABLE_ORPHAN_MAX_AGE_MS = 24 * 60 * 60_000;
/**
 * Deploy statuses that still "own" their VM. A VM referenced only by a failed
 * or deleted deploy is fair game to re-adopt — otherwise a paid machine from a
 * failed attempt is stranded forever and the next retry buys a new one.
 */
const ACTIVE_DEPLOY_STATUSES = ['pending', 'creating', 'configuring', 'ready'] as const;

export function isHermesPlan(plan: string | null): boolean {
  return plan !== null && plan.toLowerCase().replace(/\s+/g, '').includes('kvm1');
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
  /** Poll cadence while watching for a late VM after a 402 purchase. Default 15s. */
  lateVmPollIntervalMs?: number;
  /** Poll attempts for that watch (~3 min at the default cadence). Default 12. */
  lateVmPollMaxAttempts?: number;
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
    let adopted = false;
    try {
      // 1. Acquire the VM: reuse a paid orphan if one exists, else purchase.
      // Purchase SPENDS REAL MONEY (guarded by DRY_RUN above); never retried.
      // A 402 may still create the subscription + VM asynchronously (~60s later),
      // so acquireVm watches listVMs before giving up — otherwise a paid orphan leaks.
      const acquired = await this.acquireVm(deployId);
      adopted = acquired.adopted;
      const acquiredVmId = acquired.vm.id;
      vmId = acquiredVmId;
      await this.prisma.deploy.update({
        where: { id: deployId },
        data: { hostinger_vm_id: String(acquiredVmId) },
      });
      await this.log(deployId, 'purchase_vm', 'success', `vm ${acquiredVmId}`);

      // 1b. A VM left in `initial` never installs on its own — request setup explicitly.
      if (acquired.vm.state === 'initial') {
        await withRetry(
          () =>
            this.provisioning.setupVM(acquiredVmId, {
              templateId: HERMES_TEMPLATE_ID,
              dataCenterId: HERMES_DATA_CENTER_ID,
            }),
          this.retryOpts(),
        );
        await this.log(deployId, 'setup_vm', 'success', `vm ${acquiredVmId} setup requested`);
      }

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
        baseUrl: deploy.llm_base_url ?? provider.base_url,
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
      await this.fail(deployId, deploy.user_id, vmId, adopted, err);
    }
  }

  /**
   * Purchase the VM, tolerating the Hostinger 402 race: a payment failure may
   * still spawn the subscription + VM shortly after. On 402, poll listVMs for a
   * fresh, unclaimed KVM 1 VM and adopt it; give up (fail) if none appears.
   */
  private async acquireVm(
    deployId: string,
  ): Promise<{ vm: HostingerVirtualMachine; adopted: boolean }> {
    // Self-heal: if a prior deploy paid for a VM but never finished (e.g. a 402
    // race that completed after the worker gave up), reuse that paid machine
    // instead of charging the operator again.
    const orphan = await this.findAdoptableOrphan();
    if (orphan) {
      this.logger.log(`deploy ${deployId}: reusing paid orphan vm ${orphan.id}`);
      await this.log(deployId, 'adopt_orphan', 'success', `reusing paid vm ${orphan.id}`);
      return { vm: orphan, adopted: true };
    }

    const purchaseStartedAt = Date.now();
    try {
      const purchase = await this.provisioning.purchaseVM({
        itemId: HERMES_ITEM_ID,
        setup: { templateId: HERMES_TEMPLATE_ID, dataCenterId: HERMES_DATA_CENTER_ID },
      });
      return { vm: purchase.virtualMachine, adopted: false };
    } catch (err) {
      if (errorStatus(err) !== 402) throw err;
      this.logger.warn(`deploy ${deployId}: purchase returned 402 — watching for a late VM`);
      await this.log(deployId, 'purchase_402', 'warning', 'purchase 402 — watching for a late VM');
      const vm = await this.waitForLateVm(purchaseStartedAt);
      if (!vm) {
        throw new Error('Purchase failed with 402 and no VM appeared within the grace window', {
          cause: err,
        });
      }
      await this.log(deployId, 'adopt_vm', 'success', `adopted late vm ${vm.id} after 402`);
      return { vm, adopted: true };
    }
  }

  private async waitForLateVm(purchaseStartedAt: number): Promise<HostingerVirtualMachine | null> {
    const sleep = this.config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const interval = this.config.lateVmPollIntervalMs ?? LATE_VM_POLL_INTERVAL_MS;
    const maxAttempts = this.config.lateVmPollMaxAttempts ?? LATE_VM_POLL_MAX_ATTEMPTS;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const vm = await this.findAdoptableVm(purchaseStartedAt);
      if (vm) return vm;
      if (attempt < maxAttempts) await sleep(interval);
    }
    return null;
  }

  /**
   * A late VM is adoptable when it appeared after the purchase started, is a
   * KVM 1 still in initial/creating, and no deploy row already claims it.
   */
  private async findAdoptableVm(purchaseStartedAt: number): Promise<HostingerVirtualMachine | null> {
    const vms = await withRetry(() => this.provisioning.listVMs(), this.retryOpts());
    const candidates = vms.filter((vm) => {
      if (vm.state !== 'initial' && vm.state !== 'creating') return false;
      if (!isHermesPlan(vm.plan)) return false;
      const createdAt = Date.parse(vm.created_at);
      return (
        Number.isFinite(createdAt) && createdAt >= purchaseStartedAt - LATE_VM_CREATED_AT_SLACK_MS
      );
    });
    if (candidates.length === 0) return null;

    const claimedIds = await this.activeClaimedVmIds(candidates.map((vm) => String(vm.id)));
    return candidates.find((vm) => !claimedIds.has(String(vm.id))) ?? null;
  }

  /**
   * A paid VM is adoptable when it is a KVM 1 in our data center, still alive
   * (initial/creating/running), recently created, and unclaimed by any deploy.
   * KVM 1 + data-center filters exclude the control-plane box (a different
   * plan/region), so we never grab our own infrastructure. Returns the newest.
   */
  private async findAdoptableOrphan(): Promise<HostingerVirtualMachine | null> {
    const now = Date.now();
    const vms = await withRetry(() => this.provisioning.listVMs(), this.retryOpts());
    const candidates = vms.filter((vm) => {
      if (vm.state !== 'initial' && vm.state !== 'creating' && vm.state !== 'running') return false;
      if (!isHermesPlan(vm.plan)) return false;
      if (vm.data_center_id !== HERMES_DATA_CENTER_ID) return false;
      const createdAt = Date.parse(vm.created_at);
      return Number.isFinite(createdAt) && now - createdAt <= ADOPTABLE_ORPHAN_MAX_AGE_MS;
    });
    if (candidates.length === 0) return null;

    const claimedIds = await this.activeClaimedVmIds(candidates.map((vm) => String(vm.id)));
    const free = candidates
      .filter((vm) => !claimedIds.has(String(vm.id)))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    return free[0] ?? null;
  }

  /** VM ids among `ids` that are still held by an active (non-failed) deploy. */
  private async activeClaimedVmIds(ids: string[]): Promise<Set<string | null>> {
    const claimed = await this.prisma.deploy.findMany({
      where: { hostinger_vm_id: { in: ids }, status: { in: [...ACTIVE_DEPLOY_STATUSES] } },
      select: { hostinger_vm_id: true },
    });
    return new Set(claimed.map((d) => d.hostinger_vm_id));
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

  /**
   * Roll back a freshly purchased VM so a failed deploy never leaves an orphan.
   * An adopted (already-paid) VM is kept — deleting it would waste money and rob
   * the next retry of a machine it could reuse via self-heal.
   */
  private async fail(
    deployId: string,
    telegramId: bigint,
    vmId: number | undefined,
    adopted: boolean,
    err: unknown,
  ): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    this.logger.error(`deploy ${deployId} failed: ${reason}`);
    await this.log(deployId, 'error', 'error', reason);

    if (vmId !== undefined && !adopted) {
      await this.tryCleanup(deployId, 'cleanup_vm', vmId, () =>
        withRetry(() => this.provisioning.deleteVM(vmId), this.retryOpts()),
      );
    } else if (vmId !== undefined) {
      await this.log(deployId, 'cleanup_vm', 'skipped', `kept adopted vm ${vmId} for retry`);
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
