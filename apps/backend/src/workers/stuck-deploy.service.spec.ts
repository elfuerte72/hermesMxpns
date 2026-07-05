import { StuckDeployService } from './stuck-deploy.service';

const TIMEOUT_MS = 20 * 60 * 1000;
const NOW = Date.parse('2026-07-04T01:00:00Z');

describe('StuckDeployService', () => {
  let prisma: {
    deploy: { findMany: jest.Mock; update: jest.Mock };
    provisioningLog: { create: jest.Mock };
  };
  let provisioning: { deleteVM: jest.Mock };
  let notifier: { deployFailed: jest.Mock };

  function makeStuck(overrides: Record<string, unknown> = {}) {
    return {
      id: 'd1',
      user_id: 55n,
      status: 'configuring',
      hostinger_vm_id: '777',
      updated_at: new Date('2026-07-04T00:00:00Z'),
      ...overrides,
    };
  }

  function makeService(dryRun = false): StuckDeployService {
    return new StuckDeployService(prisma as never, provisioning as never, notifier as never, {
      dryRun,
      timeoutMs: TIMEOUT_MS,
    });
  }

  beforeEach(() => {
    prisma = {
      deploy: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      provisioningLog: { create: jest.fn().mockResolvedValue({}) },
    };
    provisioning = {
      deleteVM: jest.fn().mockResolvedValue(undefined),
    };
    notifier = { deployFailed: jest.fn().mockResolvedValue(undefined) };
  });

  it('queries stuck deploys with the correct cutoff and statuses', async () => {
    await makeService().sweep(NOW);
    expect(prisma.deploy.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['creating', 'configuring'] },
        updated_at: { lt: new Date(NOW - TIMEOUT_MS) },
      },
    });
  });

  it('fails a stuck deploy, cleans up its resources and notifies', async () => {
    prisma.deploy.findMany.mockResolvedValue([makeStuck()]);

    const failed = await makeService().sweep(NOW);

    expect(provisioning.deleteVM).toHaveBeenCalledWith(777);
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { status: 'failed' },
    });
    expect(notifier.deployFailed).toHaveBeenCalledWith(55n, 'Provisioning timed out');
    expect(failed).toEqual(['d1']);
  });

  it('under DRY_RUN skips deletions but still fails the deploy', async () => {
    prisma.deploy.findMany.mockResolvedValue([makeStuck()]);
    await makeService(true).sweep(NOW);
    expect(provisioning.deleteVM).not.toHaveBeenCalled();
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { status: 'failed' },
    });
  });

  it('swallows cleanup errors and still fails the deploy', async () => {
    prisma.deploy.findMany.mockResolvedValue([makeStuck()]);
    provisioning.deleteVM.mockRejectedValue(new Error('hostinger down'));
    await makeService().sweep(NOW);
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { status: 'failed' },
    });
    expect(notifier.deployFailed).toHaveBeenCalled();
  });

  it('returns empty and touches nothing when no deploy is stuck', async () => {
    const failed = await makeService().sweep(NOW);
    expect(failed).toEqual([]);
    expect(prisma.deploy.update).not.toHaveBeenCalled();
  });
});
