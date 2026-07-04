import type { HostingerVirtualMachine, HostingerVmState } from '@hermes/shared';
import {
  DeployProcessor,
  HERMES_DATA_CENTER_ID,
  HERMES_ITEM_ID,
  HERMES_TEMPLATE_ID,
  type DeployProcessorConfig,
} from './deploy.processor';

function makeVm(state: HostingerVmState, ipv4: string[], id = 777): HostingerVirtualMachine {
  return {
    id,
    hostname: 'vm',
    state,
    ipv4,
    subscription_id: null,
    data_center_id: HERMES_DATA_CENTER_ID,
    plan: null,
    created_at: '',
  };
}

describe('DeployProcessor', () => {
  let prisma: {
    deploy: { findUnique: jest.Mock; updateMany: jest.Mock; update: jest.Mock };
    provisioningLog: { create: jest.Mock };
  };
  let provisioning: {
    createPostInstallScript: jest.Mock;
    purchaseVM: jest.Mock;
    getVM: jest.Mock;
    deleteVM: jest.Mock;
    deletePostInstallScript: jest.Mock;
  };
  let notifier: { deployFailed: jest.Mock };
  let config: DeployProcessorConfig;

  function makeProcessor(overrides: Partial<DeployProcessorConfig> = {}): DeployProcessor {
    return new DeployProcessor(
      prisma as never,
      provisioning as never,
      notifier as never,
      { ...config, ...overrides },
    );
  }

  beforeEach(() => {
    prisma = {
      deploy: {
        findUnique: jest.fn().mockResolvedValue({ id: 'deploy-1', user_id: 42n, status: 'pending' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      provisioningLog: { create: jest.fn().mockResolvedValue({}) },
    };
    provisioning = {
      createPostInstallScript: jest.fn().mockResolvedValue({ id: 555, name: '', content: '' }),
      purchaseVM: jest.fn().mockResolvedValue({ orderId: 1, virtualMachine: makeVm('initial', []) }),
      getVM: jest.fn().mockResolvedValue(makeVm('running', ['203.0.113.9'])),
      deleteVM: jest.fn().mockResolvedValue(undefined),
      deletePostInstallScript: jest.fn().mockResolvedValue(undefined),
    };
    notifier = { deployFailed: jest.fn().mockResolvedValue(undefined) };
    config = {
      backendUrl: 'https://api.example.com',
      dryRun: false,
      pollIntervalMs: 1,
      pollMaxAttempts: 5,
      sleep: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('runs the happy path pending → creating → configuring with a running VM', async () => {
    await makeProcessor().process('deploy-1', 'boot-token');

    expect(prisma.deploy.updateMany).toHaveBeenCalledWith({
      where: { id: 'deploy-1', status: 'pending' },
      data: { status: 'creating' },
    });
    expect(provisioning.createPostInstallScript).toHaveBeenCalledWith(
      'hermes-deploy-1',
      expect.stringContaining('#!/usr/bin/env bash'),
    );
    expect(provisioning.purchaseVM).toHaveBeenCalledWith({
      itemId: HERMES_ITEM_ID,
      setup: {
        templateId: HERMES_TEMPLATE_ID,
        dataCenterId: HERMES_DATA_CENTER_ID,
        postInstallScriptId: 555,
      },
    });
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { hostinger_script_id: '555' },
    });
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { hostinger_vm_id: '777', status: 'configuring' },
    });
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { vm_ip: '203.0.113.9' },
    });
    // Worker stops at `configuring` — the webhook (Task 13) flips it to ready.
    expect(prisma.deploy.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ready' }) }),
    );
    expect(notifier.deployFailed).not.toHaveBeenCalled();
  });

  it('does not touch the bootstrap token embedding secrets — script has no keys', async () => {
    await makeProcessor().process('deploy-1', 'boot-token');
    const script = provisioning.createPostInstallScript.mock.calls[0][1];
    expect(script).toContain('boot-token');
    expect(script).not.toContain('TELEGRAM_BOT_TOKEN');
  });

  it('skips when the deploy is not found', async () => {
    prisma.deploy.findUnique.mockResolvedValue(null);
    await makeProcessor().process('gone', 't');
    expect(prisma.deploy.updateMany).not.toHaveBeenCalled();
    expect(provisioning.purchaseVM).not.toHaveBeenCalled();
  });

  it('is idempotent — a non-pending deploy is skipped (claim affected 0 rows)', async () => {
    prisma.deploy.updateMany.mockResolvedValue({ count: 0 });
    await makeProcessor().process('deploy-1', 't');
    expect(provisioning.createPostInstallScript).not.toHaveBeenCalled();
    expect(provisioning.purchaseVM).not.toHaveBeenCalled();
  });

  it('DRY_RUN makes no money-spending calls and does not claim', async () => {
    await makeProcessor({ dryRun: true }).process('deploy-1', 't');
    expect(prisma.deploy.updateMany).not.toHaveBeenCalled();
    expect(provisioning.purchaseVM).not.toHaveBeenCalled();
    expect(provisioning.createPostInstallScript).not.toHaveBeenCalled();
    expect(prisma.provisioningLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ step: 'dry_run' }) }),
    );
  });

  it('polls until the VM is running, sleeping between attempts', async () => {
    provisioning.getVM
      .mockResolvedValueOnce(makeVm('initial', []))
      .mockResolvedValueOnce(makeVm('running', ['9.9.9.9']));

    await makeProcessor().process('deploy-1', 't');

    expect(provisioning.getVM).toHaveBeenCalledTimes(2);
    expect(config.sleep).toHaveBeenCalledTimes(1);
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { vm_ip: '9.9.9.9' },
    });
  });

  it('cleans up the script and marks failed when purchase fails (no VM yet)', async () => {
    provisioning.purchaseVM.mockRejectedValue(new Error('purchase boom'));

    await makeProcessor().process('deploy-1', 't');

    expect(provisioning.deletePostInstallScript).toHaveBeenCalledWith(555);
    expect(provisioning.deleteVM).not.toHaveBeenCalled();
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'failed' },
    });
    expect(notifier.deployFailed).toHaveBeenCalledWith(42n, 'purchase boom');
  });

  it('deletes the VM and script when the VM enters an error state', async () => {
    provisioning.getVM.mockResolvedValue(makeVm('error', []));

    await makeProcessor().process('deploy-1', 't');

    expect(provisioning.deleteVM).toHaveBeenCalledWith(777);
    expect(provisioning.deletePostInstallScript).toHaveBeenCalledWith(555);
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'failed' },
    });
    expect(notifier.deployFailed).toHaveBeenCalled();
  });

  it('times out (and cleans up) when the VM never runs', async () => {
    provisioning.getVM.mockResolvedValue(makeVm('creating', []));

    await makeProcessor({ pollMaxAttempts: 3 }).process('deploy-1', 't');

    expect(provisioning.getVM).toHaveBeenCalledTimes(3);
    expect(provisioning.deleteVM).toHaveBeenCalledWith(777);
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'failed' },
    });
  });

  it('still marks failed even if cleanup itself throws', async () => {
    provisioning.getVM.mockResolvedValue(makeVm('error', []));
    provisioning.deleteVM.mockRejectedValue(new Error('delete failed'));

    await makeProcessor().process('deploy-1', 't');

    // Cleanup error is swallowed; the deploy is still marked failed.
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'failed' },
    });
    expect(notifier.deployFailed).toHaveBeenCalled();
  });
});
