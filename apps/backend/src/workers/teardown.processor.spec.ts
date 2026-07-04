import { TeardownProcessor, type TeardownProcessorConfig } from './teardown.processor';

describe('TeardownProcessor', () => {
  let prisma: {
    deploy: { findUnique: jest.Mock; update: jest.Mock };
    provisioningLog: { create: jest.Mock };
  };
  let provisioning: { deleteVM: jest.Mock; deletePostInstallScript: jest.Mock };
  let notifier: { deployDeleted: jest.Mock };
  let config: TeardownProcessorConfig;

  function makeDeploy(overrides: Record<string, unknown> = {}) {
    return {
      id: 'deploy-1',
      user_id: 55n,
      bot_username: 'coolbot',
      status: 'ready',
      hostinger_vm_id: '777',
      hostinger_script_id: '555',
      ...overrides,
    };
  }

  function makeProcessor(dryRun = false): TeardownProcessor {
    return new TeardownProcessor(prisma as never, provisioning as never, notifier as never, {
      ...config,
      dryRun,
    });
  }

  beforeEach(() => {
    prisma = {
      deploy: {
        findUnique: jest.fn().mockResolvedValue(makeDeploy()),
        update: jest.fn().mockResolvedValue({}),
      },
      provisioningLog: { create: jest.fn().mockResolvedValue({}) },
    };
    provisioning = {
      deleteVM: jest.fn().mockResolvedValue(undefined),
      deletePostInstallScript: jest.fn().mockResolvedValue(undefined),
    };
    notifier = { deployDeleted: jest.fn().mockResolvedValue(undefined) };
    config = { dryRun: false };
  });

  it('deletes the VM + script, marks deleted and notifies', async () => {
    await makeProcessor().process('deploy-1');

    expect(provisioning.deleteVM).toHaveBeenCalledWith(777);
    expect(provisioning.deletePostInstallScript).toHaveBeenCalledWith(555);
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'deleted' },
    });
    expect(notifier.deployDeleted).toHaveBeenCalledWith(55n, 'coolbot');
  });

  it('is a no-op for an already-deleted deploy', async () => {
    prisma.deploy.findUnique.mockResolvedValue(makeDeploy({ status: 'deleted' }));
    await makeProcessor().process('deploy-1');
    expect(provisioning.deleteVM).not.toHaveBeenCalled();
    expect(prisma.deploy.update).not.toHaveBeenCalled();
    expect(notifier.deployDeleted).not.toHaveBeenCalled();
  });

  it('skips when the deploy is not found', async () => {
    prisma.deploy.findUnique.mockResolvedValue(null);
    await makeProcessor().process('gone');
    expect(prisma.deploy.update).not.toHaveBeenCalled();
  });

  it('under DRY_RUN skips Hostinger deletions but still marks deleted', async () => {
    await makeProcessor(true).process('deploy-1');
    expect(provisioning.deleteVM).not.toHaveBeenCalled();
    expect(provisioning.deletePostInstallScript).not.toHaveBeenCalled();
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'deleted' },
    });
  });

  it('still marks deleted when a Hostinger deletion throws', async () => {
    provisioning.deleteVM.mockRejectedValue(new Error('hostinger down'));
    await makeProcessor().process('deploy-1');
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'deleted' },
    });
    expect(notifier.deployDeleted).toHaveBeenCalled();
  });

  it('handles a deploy with no provisioned resources', async () => {
    prisma.deploy.findUnique.mockResolvedValue(
      makeDeploy({ hostinger_vm_id: null, hostinger_script_id: null }),
    );
    await makeProcessor().process('deploy-1');
    expect(provisioning.deleteVM).not.toHaveBeenCalled();
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'deleted' },
    });
  });
});
