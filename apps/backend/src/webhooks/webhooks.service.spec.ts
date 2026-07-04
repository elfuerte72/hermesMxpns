import { NotFoundException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { hashBootstrapToken } from '../deploys/bootstrap-token';

const SECRET = 'd'.repeat(64);

describe('WebhooksService', () => {
  let prisma: {
    deploy: { findUnique: jest.Mock; updateMany: jest.Mock };
    provisioningLog: { create: jest.Mock };
  };
  let provisioning: { deletePostInstallScript: jest.Mock };
  let notifier: { deployReady: jest.Mock };

  function makeDeploy(overrides: Record<string, unknown> = {}) {
    return {
      id: 'deploy-1',
      user_id: 55n,
      bot_username: 'coolbot',
      status: 'configuring',
      webhook_secret_hash: hashBootstrapToken(SECRET),
      hostinger_script_id: '555',
      ...overrides,
    };
  }

  function makeService(dryRun = false): WebhooksService {
    return new WebhooksService(prisma as never, provisioning as never, notifier as never, dryRun);
  }

  beforeEach(() => {
    prisma = {
      deploy: {
        findUnique: jest.fn().mockResolvedValue(makeDeploy()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      provisioningLog: { create: jest.fn().mockResolvedValue({}) },
    };
    provisioning = { deletePostInstallScript: jest.fn().mockResolvedValue(undefined) };
    notifier = { deployReady: jest.fn().mockResolvedValue(undefined) };
  });

  it('marks the deploy ready, cleans up the script and notifies the client', async () => {
    const result = await makeService().deployReady('deploy-1', SECRET);

    expect(result).toEqual({ status: 'ready' });
    expect(prisma.deploy.updateMany).toHaveBeenCalledWith({
      where: { id: 'deploy-1', status: { in: ['creating', 'configuring'] } },
      data: { status: 'ready' },
    });
    expect(provisioning.deletePostInstallScript).toHaveBeenCalledWith(555);
    expect(notifier.deployReady).toHaveBeenCalledWith(55n, 'coolbot');
  });

  it('404s for an invalid webhook signature', async () => {
    await expect(makeService().deployReady('deploy-1', 'wrong')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.deploy.updateMany).not.toHaveBeenCalled();
    expect(notifier.deployReady).not.toHaveBeenCalled();
  });

  it('404s for a missing signature', async () => {
    await expect(makeService().deployReady('deploy-1', '')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s for an unknown deploy', async () => {
    prisma.deploy.findUnique.mockResolvedValue(null);
    await expect(makeService().deployReady('nope', SECRET)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s when no webhook secret was ever issued (bootstrap not done)', async () => {
    prisma.deploy.findUnique.mockResolvedValue(makeDeploy({ webhook_secret_hash: null }));
    await expect(makeService().deployReady('deploy-1', SECRET)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('is idempotent — a repeat for an already-ready deploy returns 200 without side effects', async () => {
    prisma.deploy.findUnique.mockResolvedValue(makeDeploy({ status: 'ready' }));
    const result = await makeService().deployReady('deploy-1', SECRET);

    expect(result).toEqual({ status: 'ready' });
    expect(prisma.deploy.updateMany).not.toHaveBeenCalled();
    expect(provisioning.deletePostInstallScript).not.toHaveBeenCalled();
    expect(notifier.deployReady).not.toHaveBeenCalled();
  });

  it('404s when the deploy is in a terminal non-ready state (e.g. failed)', async () => {
    prisma.deploy.findUnique.mockResolvedValue(makeDeploy({ status: 'failed' }));
    prisma.deploy.updateMany.mockResolvedValue({ count: 0 });
    await expect(makeService().deployReady('deploy-1', SECRET)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('skips script deletion under DRY_RUN but still marks ready + notifies', async () => {
    const result = await makeService(true).deployReady('deploy-1', SECRET);
    expect(result).toEqual({ status: 'ready' });
    expect(provisioning.deletePostInstallScript).not.toHaveBeenCalled();
    expect(notifier.deployReady).toHaveBeenCalled();
  });

  it('still succeeds when script cleanup or notification throws', async () => {
    provisioning.deletePostInstallScript.mockRejectedValue(new Error('hostinger down'));
    notifier.deployReady.mockRejectedValue(new Error('telegram down'));

    const result = await makeService().deployReady('deploy-1', SECRET);
    expect(result).toEqual({ status: 'ready' });
  });
});
