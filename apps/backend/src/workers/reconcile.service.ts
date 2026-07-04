import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisioningService } from '../provisioning/provisioning.service';

export interface ReconcileConfig {
  dryRun: boolean;
  /** Delete orphan VMs instead of only alerting. Off by default (dangerous). */
  deleteOrphans: boolean;
}

export interface ReconcileResult {
  hostingerVmCount: number;
  /** VMs in Hostinger not backed by an active deploy. */
  orphanVmIds: number[];
  deletedOrphanVmIds: number[];
  /** Active deploys whose recorded VM is gone from Hostinger. */
  missingVmDeployIds: string[];
}

/**
 * Reconciles DB deploys against the real Hostinger VM inventory. Detects orphan
 * VMs (billed but untracked) and deploys whose VM has vanished. Run daily.
 */
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: ProvisioningService,
    private readonly config: ReconcileConfig,
  ) {}

  async reconcile(): Promise<ReconcileResult> {
    const vms = await this.provisioning.listVMs();
    const deploys = await this.prisma.deploy.findMany({
      where: { hostinger_vm_id: { not: null } },
      select: { id: true, hostinger_vm_id: true, status: true },
    });

    // A VM is legitimate only if an active (non-deleted) deploy claims it.
    const activeVmIds = new Set(
      deploys.filter((d) => d.status !== 'deleted').map((d) => d.hostinger_vm_id),
    );

    const orphans = vms.filter((vm) => !activeVmIds.has(String(vm.id)));
    const deletedOrphanVmIds: number[] = [];
    for (const vm of orphans) {
      this.logger.warn(`Orphan VM ${vm.id} (${vm.ipv4[0] ?? '?'}) — no active deploy`);
      if (this.config.deleteOrphans && !this.config.dryRun) {
        try {
          await this.provisioning.deleteVM(vm.id);
          deletedOrphanVmIds.push(vm.id);
          this.logger.log(`Deleted orphan VM ${vm.id}`);
        } catch (err) {
          this.logger.error(`Failed to delete orphan VM ${vm.id}: ${String(err)}`);
        }
      }
    }

    // Active deploys whose VM is no longer present in Hostinger.
    const liveVmIds = new Set(vms.map((vm) => String(vm.id)));
    const missing = deploys.filter(
      (d) => d.status !== 'deleted' && d.hostinger_vm_id !== null && !liveVmIds.has(d.hostinger_vm_id),
    );
    for (const d of missing) {
      this.logger.warn(`Deploy ${d.id} references VM ${d.hostinger_vm_id} missing from Hostinger`);
    }

    this.logger.log(
      `Reconcile: ${vms.length} VMs, ${orphans.length} orphan(s), ${missing.length} missing`,
    );
    return {
      hostingerVmCount: vms.length,
      orphanVmIds: orphans.map((o) => o.id),
      deletedOrphanVmIds,
      missingVmDeployIds: missing.map((d) => d.id),
    };
  }
}
