import type { HostingerVirtualMachine } from '@hermes/shared';
import { ReconcileService, type ReconcileConfig } from './reconcile.service';

function vm(id: number, ip = '1.2.3.4'): HostingerVirtualMachine {
  return {
    id,
    hostname: 'vm',
    state: 'running',
    ipv4: [ip],
    subscription_id: null,
    data_center_id: 11,
    plan: null,
    created_at: '',
  };
}

describe('ReconcileService', () => {
  let prisma: { deploy: { findMany: jest.Mock } };
  let provisioning: { listVMs: jest.Mock; deleteVM: jest.Mock };
  let config: ReconcileConfig;

  function makeService(overrides: Partial<ReconcileConfig> = {}): ReconcileService {
    return new ReconcileService(prisma as never, provisioning as never, { ...config, ...overrides });
  }

  beforeEach(() => {
    prisma = { deploy: { findMany: jest.fn().mockResolvedValue([]) } };
    provisioning = {
      listVMs: jest.fn().mockResolvedValue([]),
      deleteVM: jest.fn().mockResolvedValue(undefined),
    };
    config = { dryRun: false, deleteOrphans: false };
  });

  it('flags a VM with no active deploy as an orphan (alert-only by default)', async () => {
    provisioning.listVMs.mockResolvedValue([vm(777)]);
    prisma.deploy.findMany.mockResolvedValue([]);

    const result = await makeService().reconcile();

    expect(result.orphanVmIds).toEqual([777]);
    expect(result.deletedOrphanVmIds).toEqual([]);
    expect(provisioning.deleteVM).not.toHaveBeenCalled();
  });

  it('does not flag a VM claimed by an active deploy', async () => {
    provisioning.listVMs.mockResolvedValue([vm(777)]);
    prisma.deploy.findMany.mockResolvedValue([
      { id: 'd1', hostinger_vm_id: '777', status: 'ready' },
    ]);

    const result = await makeService().reconcile();
    expect(result.orphanVmIds).toEqual([]);
  });

  it('treats a VM claimed only by a deleted deploy as an orphan', async () => {
    provisioning.listVMs.mockResolvedValue([vm(777)]);
    prisma.deploy.findMany.mockResolvedValue([
      { id: 'd1', hostinger_vm_id: '777', status: 'deleted' },
    ]);

    const result = await makeService().reconcile();
    expect(result.orphanVmIds).toEqual([777]);
  });

  it('deletes orphans when deleteOrphans is on and not DRY_RUN', async () => {
    provisioning.listVMs.mockResolvedValue([vm(777)]);
    prisma.deploy.findMany.mockResolvedValue([]);

    const result = await makeService({ deleteOrphans: true }).reconcile();

    expect(provisioning.deleteVM).toHaveBeenCalledWith(777);
    expect(result.deletedOrphanVmIds).toEqual([777]);
  });

  it('never deletes orphans under DRY_RUN even if deleteOrphans is on', async () => {
    provisioning.listVMs.mockResolvedValue([vm(777)]);
    prisma.deploy.findMany.mockResolvedValue([]);

    await makeService({ deleteOrphans: true, dryRun: true }).reconcile();
    expect(provisioning.deleteVM).not.toHaveBeenCalled();
  });

  it('reports active deploys whose VM vanished from Hostinger', async () => {
    provisioning.listVMs.mockResolvedValue([]);
    prisma.deploy.findMany.mockResolvedValue([
      { id: 'd1', hostinger_vm_id: '777', status: 'ready' },
    ]);

    const result = await makeService().reconcile();
    expect(result.missingVmDeployIds).toEqual(['d1']);
  });

  it('swallows a delete failure and keeps reconciling', async () => {
    provisioning.listVMs.mockResolvedValue([vm(777), vm(888)]);
    prisma.deploy.findMany.mockResolvedValue([]);
    provisioning.deleteVM.mockRejectedValueOnce(new Error('boom'));

    const result = await makeService({ deleteOrphans: true }).reconcile();
    // 777 failed to delete, 888 succeeded.
    expect(result.deletedOrphanVmIds).toEqual([888]);
    expect(result.orphanVmIds).toEqual([777, 888]);
  });
});
