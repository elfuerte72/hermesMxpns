import { TeardownProcessor, type TeardownProcessorConfig } from './teardown.processor';

describe('TeardownProcessor', () => {
  let prisma: {
    deploy: { findUnique: jest.Mock; update: jest.Mock; count: jest.Mock };
    provisioningLog: { create: jest.Mock };
  };
  let provisioning: { deleteVM: jest.Mock };
  let notifier: { deployDeleted: jest.Mock };
  let openRouterKeys: { deleteKey: jest.Mock };
  let config: TeardownProcessorConfig;

  function makeDeploy(overrides: Record<string, unknown> = {}) {
    return {
      id: 'deploy-1',
      user_id: 55n,
      bot_username: 'coolbot',
      status: 'ready',
      hostinger_vm_id: '777',
      openrouter_key_hash: 'key-hash-1',
      ...overrides,
    };
  }

  function makeProcessor(dryRun = false): TeardownProcessor {
    return new TeardownProcessor(
      prisma as never,
      provisioning as never,
      notifier as never,
      { ...config, dryRun },
      openRouterKeys as never,
    );
  }

  beforeEach(() => {
    prisma = {
      deploy: {
        findUnique: jest.fn().mockResolvedValue(makeDeploy()),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      provisioningLog: { create: jest.fn().mockResolvedValue({}) },
    };
    provisioning = { deleteVM: jest.fn().mockResolvedValue(undefined) };
    notifier = { deployDeleted: jest.fn().mockResolvedValue(undefined) };
    openRouterKeys = { deleteKey: jest.fn().mockResolvedValue(undefined) };
    config = { dryRun: false };
  });

  it('deletes the VM and the managed key, marks deleted and notifies', async () => {
    await makeProcessor().process('deploy-1');

    expect(provisioning.deleteVM).toHaveBeenCalledWith(777);
    expect(openRouterKeys.deleteKey).toHaveBeenCalledWith('key-hash-1');
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'deleted' },
    });
    expect(notifier.deployDeleted).toHaveBeenCalledWith(55n, 'coolbot');
  });

  it('keeps the VM when another active deploy still relies on it (but still deletes the key)', async () => {
    prisma.deploy.count.mockResolvedValue(1);

    await makeProcessor().process('deploy-1');

    expect(provisioning.deleteVM).not.toHaveBeenCalled();
    expect(openRouterKeys.deleteKey).toHaveBeenCalledWith('key-hash-1');
    expect(prisma.deploy.count).toHaveBeenCalledWith({
      where: {
        hostinger_vm_id: '777',
        id: { not: 'deploy-1' },
        status: { in: ['pending', 'creating', 'configuring', 'ready'] },
      },
    });
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'deleted' },
    });
  });

  it('is a no-op for an already-deleted deploy', async () => {
    prisma.deploy.findUnique.mockResolvedValue(makeDeploy({ status: 'deleted' }));
    await makeProcessor().process('deploy-1');
    expect(provisioning.deleteVM).not.toHaveBeenCalled();
    expect(openRouterKeys.deleteKey).not.toHaveBeenCalled();
    expect(prisma.deploy.update).not.toHaveBeenCalled();
    expect(notifier.deployDeleted).not.toHaveBeenCalled();
  });

  it('skips when the deploy is not found', async () => {
    prisma.deploy.findUnique.mockResolvedValue(null);
    await makeProcessor().process('gone');
    expect(prisma.deploy.update).not.toHaveBeenCalled();
  });

  it('under DRY_RUN skips Hostinger/OpenRouter deletions but still marks deleted', async () => {
    await makeProcessor(true).process('deploy-1');
    expect(provisioning.deleteVM).not.toHaveBeenCalled();
    expect(openRouterKeys.deleteKey).not.toHaveBeenCalled();
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

  it('still marks deleted when the OpenRouter key deletion throws', async () => {
    openRouterKeys.deleteKey.mockRejectedValue(new Error('openrouter down'));
    await makeProcessor().process('deploy-1');
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'deleted' },
    });
    expect(notifier.deployDeleted).toHaveBeenCalled();
  });

  it('handles a deploy with no provisioned resources (no VM, no key)', async () => {
    prisma.deploy.findUnique.mockResolvedValue(
      makeDeploy({ hostinger_vm_id: null, openrouter_key_hash: null }),
    );
    await makeProcessor().process('deploy-1');
    expect(provisioning.deleteVM).not.toHaveBeenCalled();
    expect(openRouterKeys.deleteKey).not.toHaveBeenCalled();
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'deleted' },
    });
  });

  it('deletes only the key when the deploy has no VM but has a managed key', async () => {
    prisma.deploy.findUnique.mockResolvedValue(makeDeploy({ hostinger_vm_id: null }));
    await makeProcessor().process('deploy-1');
    expect(provisioning.deleteVM).not.toHaveBeenCalled();
    expect(openRouterKeys.deleteKey).toHaveBeenCalledWith('key-hash-1');
  });
});
