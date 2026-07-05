import type {
  HostingerDockerContainer,
  HostingerVirtualMachine,
  HostingerVmState,
} from '@hermes/shared';
import { SecretsService } from '../secrets/secrets.service';
import {
  DeployProcessor,
  HERMES_DATA_CENTER_ID,
  HERMES_ITEM_ID,
  HERMES_TEMPLATE_ID,
  hermesProjectName,
  type DeployProcessorConfig,
} from './deploy.processor';

const TEST_KEY = 'a'.repeat(64);

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

function makeContainer(
  state: HostingerDockerContainer['state'],
  name = 'hermes-1',
): HostingerDockerContainer {
  return {
    id: 'abc',
    name,
    image: 'nousresearch/hermes-agent:latest',
    status: '',
    state,
    health: '',
  };
}

describe('DeployProcessor', () => {
  let secrets: SecretsService;
  let prisma: {
    deploy: { findUnique: jest.Mock; updateMany: jest.Mock; update: jest.Mock };
    provisioningLog: { create: jest.Mock };
  };
  let provisioning: {
    purchaseVM: jest.Mock;
    getVM: jest.Mock;
    createDockerProject: jest.Mock;
    getDockerProjectContainers: jest.Mock;
    deleteVM: jest.Mock;
  };
  let notifier: { deployFailed: jest.Mock; deployReady: jest.Mock };
  let config: DeployProcessorConfig;

  function makeDeployRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'deploy-1',
      user_id: 42n,
      status: 'pending',
      bot_username: 'coolbot',
      bot_token_enc: secrets.encrypt('123456:abc'),
      llm_key_enc: secrets.encrypt('sk-groq'),
      llm_provider: 'groq',
      llm_base_url: null,
      llm_model: null,
      ...overrides,
    };
  }

  function makeProcessor(overrides: Partial<DeployProcessorConfig> = {}): DeployProcessor {
    return new DeployProcessor(prisma as never, provisioning as never, secrets, notifier as never, {
      ...config,
      ...overrides,
    });
  }

  beforeEach(() => {
    secrets = new SecretsService(TEST_KEY);
    prisma = {
      deploy: {
        findUnique: jest.fn().mockResolvedValue(makeDeployRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      provisioningLog: { create: jest.fn().mockResolvedValue({}) },
    };
    provisioning = {
      purchaseVM: jest
        .fn()
        .mockResolvedValue({ orderId: 1, virtualMachine: makeVm('initial', []) }),
      getVM: jest.fn().mockResolvedValue(makeVm('running', ['203.0.113.9'])),
      createDockerProject: jest.fn().mockResolvedValue(undefined),
      getDockerProjectContainers: jest.fn().mockResolvedValue([makeContainer('running')]),
      deleteVM: jest.fn().mockResolvedValue(undefined),
    };
    notifier = {
      deployFailed: jest.fn().mockResolvedValue(undefined),
      deployReady: jest.fn().mockResolvedValue(undefined),
    };
    config = {
      dryRun: false,
      pollIntervalMs: 1,
      pollMaxAttempts: 5,
      sleep: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('runs the happy path pending → creating → configuring → ready', async () => {
    await makeProcessor().process('deploy-1');

    expect(prisma.deploy.updateMany).toHaveBeenCalledWith({
      where: { id: 'deploy-1', status: 'pending' },
      data: { status: 'creating' },
    });
    expect(provisioning.purchaseVM).toHaveBeenCalledWith({
      itemId: HERMES_ITEM_ID,
      setup: { templateId: HERMES_TEMPLATE_ID, dataCenterId: HERMES_DATA_CENTER_ID },
    });
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { hostinger_vm_id: '777' },
    });
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { vm_ip: '203.0.113.9', status: 'configuring' },
    });
    expect(provisioning.createDockerProject).toHaveBeenCalledWith(
      777,
      hermesProjectName('deploy-1'),
      expect.stringContaining('nousresearch/hermes-agent'),
      expect.stringContaining('TELEGRAM_BOT_TOKEN=123456:abc'),
    );
    expect(prisma.deploy.updateMany).toHaveBeenCalledWith({
      where: { id: 'deploy-1', status: 'configuring' },
      data: { status: 'ready' },
    });
    expect(notifier.deployReady).toHaveBeenCalledWith(42n, 'coolbot');
    expect(notifier.deployFailed).not.toHaveBeenCalled();
  });

  it('sends decrypted secrets in the project env, not in the compose content', async () => {
    await makeProcessor().process('deploy-1');

    const [, , compose, env] = provisioning.createDockerProject.mock.calls[0];
    expect(env).toContain('TELEGRAM_BOT_TOKEN=123456:abc');
    expect(env).toContain('GROQ_API_KEY=sk-groq');
    expect(env).toContain('TELEGRAM_ALLOWED_USERS=42');
    expect(compose).not.toContain('123456:abc');
    expect(compose).not.toContain('sk-groq');
    expect(compose).toContain('base_url: "https://api.groq.com/openai/v1"');
    expect(compose).toContain('key_env: "GROQ_API_KEY"');
  });

  it('uses the deploy llm_base_url/llm_model overrides for the custom provider', async () => {
    prisma.deploy.findUnique.mockResolvedValue(
      makeDeployRow({
        llm_provider: 'custom',
        llm_base_url: 'https://llm.example.com/v1',
        llm_model: 'my-model',
      }),
    );

    await makeProcessor().process('deploy-1');

    const compose = provisioning.createDockerProject.mock.calls[0][2];
    expect(compose).toContain('base_url: "https://llm.example.com/v1"');
    expect(compose).toContain('default: "my-model"');
  });

  it('skips when the deploy is not found', async () => {
    prisma.deploy.findUnique.mockResolvedValue(null);
    await makeProcessor().process('gone');
    expect(prisma.deploy.updateMany).not.toHaveBeenCalled();
    expect(provisioning.purchaseVM).not.toHaveBeenCalled();
  });

  it('is idempotent — a non-pending deploy is skipped (claim affected 0 rows)', async () => {
    prisma.deploy.updateMany.mockResolvedValue({ count: 0 });
    await makeProcessor().process('deploy-1');
    expect(provisioning.purchaseVM).not.toHaveBeenCalled();
    expect(provisioning.createDockerProject).not.toHaveBeenCalled();
  });

  it('DRY_RUN makes no money-spending calls and does not claim', async () => {
    await makeProcessor({ dryRun: true }).process('deploy-1');
    expect(prisma.deploy.updateMany).not.toHaveBeenCalled();
    expect(provisioning.purchaseVM).not.toHaveBeenCalled();
    expect(provisioning.createDockerProject).not.toHaveBeenCalled();
    expect(prisma.provisioningLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ step: 'dry_run' }) }),
    );
  });

  it('polls until the VM is running, sleeping between attempts', async () => {
    provisioning.getVM
      .mockResolvedValueOnce(makeVm('initial', []))
      .mockResolvedValueOnce(makeVm('running', ['9.9.9.9']));

    await makeProcessor().process('deploy-1');

    expect(provisioning.getVM).toHaveBeenCalledTimes(2);
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { vm_ip: '9.9.9.9', status: 'configuring' },
    });
  });

  it('retries a transient getVM error during polling instead of failing', async () => {
    provisioning.getVM
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValue(makeVm('running', ['9.9.9.9']));

    await makeProcessor({ retries: 3, retryBaseDelayMs: 1 }).process('deploy-1');

    expect(provisioning.getVM).toHaveBeenCalledTimes(2);
    expect(notifier.deployFailed).not.toHaveBeenCalled();
  });

  it('fails (without retrying) on a non-transient getVM error', async () => {
    provisioning.getVM.mockRejectedValue({ response: { status: 404 } });

    await makeProcessor({ retries: 3, retryBaseDelayMs: 1 }).process('deploy-1');

    expect(provisioning.getVM).toHaveBeenCalledTimes(1);
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'failed' },
    });
  });

  it('does not retry purchaseVM and marks failed when it throws (no VM yet)', async () => {
    provisioning.purchaseVM.mockRejectedValue({ response: { status: 500 } });

    await makeProcessor({ retries: 3, retryBaseDelayMs: 1 }).process('deploy-1');

    expect(provisioning.purchaseVM).toHaveBeenCalledTimes(1);
    expect(provisioning.deleteVM).not.toHaveBeenCalled();
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'failed' },
    });
    expect(notifier.deployFailed).toHaveBeenCalledWith(42n, expect.any(String));
  });

  it('deletes the VM when the VM enters an error state', async () => {
    provisioning.getVM.mockResolvedValue(makeVm('error', []));

    await makeProcessor().process('deploy-1');

    expect(provisioning.deleteVM).toHaveBeenCalledWith(777);
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'failed' },
    });
    expect(notifier.deployFailed).toHaveBeenCalled();
  });

  it('retries a transient createDockerProject error', async () => {
    provisioning.createDockerProject
      .mockRejectedValueOnce({ response: { status: 502 } })
      .mockResolvedValue(undefined);

    await makeProcessor({ retries: 3, retryBaseDelayMs: 1 }).process('deploy-1');

    expect(provisioning.createDockerProject).toHaveBeenCalledTimes(2);
    expect(notifier.deployReady).toHaveBeenCalled();
  });

  it('cleans up the VM and fails when createDockerProject errors out', async () => {
    provisioning.createDockerProject.mockRejectedValue({ response: { status: 400 } });

    await makeProcessor().process('deploy-1');

    expect(provisioning.deleteVM).toHaveBeenCalledWith(777);
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'failed' },
    });
    expect(notifier.deployReady).not.toHaveBeenCalled();
  });

  it('polls containers until one is running, tolerating an early 404', async () => {
    provisioning.getDockerProjectContainers
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce([makeContainer('created')])
      .mockResolvedValueOnce([makeContainer('running')]);

    await makeProcessor().process('deploy-1');

    expect(provisioning.getDockerProjectContainers).toHaveBeenCalledTimes(3);
    expect(provisioning.getDockerProjectContainers).toHaveBeenCalledWith(
      777,
      hermesProjectName('deploy-1'),
    );
    expect(notifier.deployReady).toHaveBeenCalledWith(42n, 'coolbot');
  });

  it('fails when a project container exits before becoming ready', async () => {
    provisioning.getDockerProjectContainers.mockResolvedValue([makeContainer('exited')]);

    await makeProcessor().process('deploy-1');

    expect(provisioning.deleteVM).toHaveBeenCalledWith(777);
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'failed' },
    });
    expect(notifier.deployReady).not.toHaveBeenCalled();
  });

  it('times out (and cleans up) when no container ever runs', async () => {
    provisioning.getDockerProjectContainers.mockResolvedValue([makeContainer('created')]);

    await makeProcessor({ pollMaxAttempts: 3 }).process('deploy-1');

    expect(provisioning.getDockerProjectContainers).toHaveBeenCalledTimes(3);
    expect(provisioning.deleteVM).toHaveBeenCalledWith(777);
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'failed' },
    });
  });

  it('does not mark ready when the deploy left configuring meanwhile', async () => {
    prisma.deploy.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await makeProcessor().process('deploy-1');

    expect(notifier.deployReady).not.toHaveBeenCalled();
    expect(prisma.deploy.update).not.toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'failed' },
    });
  });

  it('fails on an unknown LLM provider and cleans up the VM', async () => {
    prisma.deploy.findUnique.mockResolvedValue(makeDeployRow({ llm_provider: 'nope' }));

    await makeProcessor().process('deploy-1');

    expect(provisioning.createDockerProject).not.toHaveBeenCalled();
    expect(provisioning.deleteVM).toHaveBeenCalledWith(777);
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'failed' },
    });
  });

  it('times out when the VM never runs', async () => {
    provisioning.getVM.mockResolvedValue(makeVm('creating', []));

    await makeProcessor({ pollMaxAttempts: 3 }).process('deploy-1');

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

    await makeProcessor().process('deploy-1');

    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { status: 'failed' },
    });
    expect(notifier.deployFailed).toHaveBeenCalled();
  });
});
