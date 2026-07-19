import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { AuthenticatedUser } from '@hermes/shared';
import { DeploysService } from './deploys.service';
import { SecretsService } from '../secrets/secrets.service';
import type { CreateDeployDto } from './create-deploy.dto';

const USER: AuthenticatedUser = { telegram_id: '12345', username: 'alice' };
const CHANNEL_ID = -1001234567890n;
// 32-byte test key (64 hex) — real AES-256-GCM encryption in the assertions below.
const TEST_KEY = 'a'.repeat(64);

describe('DeploysService', () => {
  let prisma: {
    user: { upsert: jest.Mock };
    deploy: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    provisioningLog: { create: jest.Mock };
  };
  let secrets: SecretsService;
  let validateBotToken: { validate: jest.Mock };
  let queue: { enqueueDeploy: jest.Mock };
  let teardownQueue: { enqueueTeardown: jest.Mock };
  let provisioning: {
    restartDockerProject: jest.Mock;
    updateDockerProject: jest.Mock;
    getVM: jest.Mock;
    getDockerProjectContainers: jest.Mock;
  };
  let validateLlmKey: { validate: jest.Mock };
  let subscription: { isGatingEnabled: jest.Mock; getLiveStatus: jest.Mock };
  let service: DeploysService;

  function makeService(channelId: bigint | null = null): DeploysService {
    return new DeploysService(
      prisma as never,
      secrets,
      validateBotToken as never,
      queue as never,
      teardownQueue as never,
      provisioning as never,
      validateLlmKey as never,
      subscription as never,
      channelId,
    );
  }

  beforeEach(() => {
    prisma = {
      user: { upsert: jest.fn().mockResolvedValue(undefined) },
      deploy: {
        create: jest.fn().mockResolvedValue({ id: 'deploy-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(undefined),
      },
      provisioningLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    secrets = new SecretsService(TEST_KEY);
    validateBotToken = { validate: jest.fn().mockResolvedValue({ username: 'mybot', id: 7 }) };
    queue = { enqueueDeploy: jest.fn().mockResolvedValue(undefined) };
    teardownQueue = { enqueueTeardown: jest.fn().mockResolvedValue(undefined) };
    provisioning = {
      restartDockerProject: jest.fn().mockResolvedValue(undefined),
      updateDockerProject: jest.fn().mockResolvedValue(undefined),
      getVM: jest.fn().mockResolvedValue({
        id: 777,
        state: 'running',
        ipv4: ['1.2.3.4'],
      }),
      getDockerProjectContainers: jest
        .fn()
        .mockResolvedValue([
          {
            id: 'c1',
            name: 'hermes-hermes-1',
            image: 'nousresearch/hermes-agent:latest',
            status: 'Up 2 hours',
            state: 'running',
            health: 'healthy',
          },
        ]),
    };
    validateLlmKey = { validate: jest.fn().mockResolvedValue({ ok: true }) };
    subscription = {
      isGatingEnabled: jest.fn().mockReturnValue(false),
      getLiveStatus: jest.fn().mockResolvedValue('active'),
    };
    service = makeService();
  });

  describe('create — one-click bundle', () => {
    const ONE_CLICK: CreateDeployDto = { bot_token: '123456:abc' };

    it('validates the bot token, persists a pending openrouter deploy (no key) and enqueues', async () => {
      const result = await service.create(USER, ONE_CLICK);

      expect(validateBotToken.validate).toHaveBeenCalledWith('123456:abc');
      expect(result).toEqual({ deploy_id: 'deploy-1', status: 'pending' });
      const data = prisma.deploy.create.mock.calls[0][0].data;
      expect(data.llm_provider).toBe('openrouter');
      expect(data.llm_key_enc).toBeNull();
      expect(data.bot_username).toBe('mybot');
      expect(data.user_id).toBe(12345n);
      expect(queue.enqueueDeploy).toHaveBeenCalledWith({ deployId: 'deploy-1' });
    });

    it('stores the encrypted bot token but never the plaintext', async () => {
      await service.create(USER, ONE_CLICK);
      const data = prisma.deploy.create.mock.calls[0][0].data;
      expect(secrets.decrypt(data.bot_token_enc)).toBe('123456:abc');
      const serialized = JSON.stringify(data, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      );
      expect(serialized).not.toContain('123456:abc');
      expect(data).not.toHaveProperty('bot_token');
    });

    it('does not require an llm_key or llm_provider in the body', async () => {
      await service.create(USER, ONE_CLICK);
      const data = prisma.deploy.create.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('llm_key');
      expect(data.llm_key_enc).toBeNull();
    });

    it('skips the subscription gate when gating is disabled (dev)', async () => {
      await service.create(USER, ONE_CLICK);
      expect(subscription.isGatingEnabled).toHaveBeenCalled();
      expect(subscription.getLiveStatus).not.toHaveBeenCalled();
      expect(prisma.deploy.create.mock.calls[0][0].data.subscription_status).toBeNull();
    });

    it('requires an active subscription when gating is enabled and stamps it on the deploy', async () => {
      subscription.isGatingEnabled.mockReturnValue(true);
      subscription.getLiveStatus.mockResolvedValue('active');
      service = makeService(CHANNEL_ID);

      await service.create(USER, ONE_CLICK);

      expect(subscription.getLiveStatus).toHaveBeenCalledWith(USER);
      const data = prisma.deploy.create.mock.calls[0][0].data;
      expect(data.subscription_status).toBe('active');
      expect(data.subscription_channel_id).toBe(CHANNEL_ID);
    });

    it.each(['expired', 'none'] as const)(
      'blocks creation with 402 when subscription is %s',
      async (status) => {
        subscription.isGatingEnabled.mockReturnValue(true);
        subscription.getLiveStatus.mockResolvedValue(status);
        service = makeService(CHANNEL_ID);

        await expect(service.create(USER, ONE_CLICK)).rejects.toMatchObject({
          status: 402,
        });
        expect(prisma.deploy.create).not.toHaveBeenCalled();
        expect(queue.enqueueDeploy).not.toHaveBeenCalled();
      },
    );

    it('does not create a deploy or enqueue when the bot token is invalid (422)', async () => {
      validateBotToken.validate.mockRejectedValue(new UnprocessableEntityException());

      await expect(service.create(USER, ONE_CLICK)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(prisma.deploy.create).not.toHaveBeenCalled();
      expect(queue.enqueueDeploy).not.toHaveBeenCalled();
    });

    it('propagates a 409 when the bot is already used by an active deploy', async () => {
      validateBotToken.validate.mockRejectedValue(new ConflictException());

      await expect(service.create(USER, ONE_CLICK)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.deploy.create).not.toHaveBeenCalled();
      expect(queue.enqueueDeploy).not.toHaveBeenCalled();
    });
  });

  describe('create — BYOK (hidden Advanced)', () => {
    it('encrypts and stores a user-supplied custom key with base_url and model', async () => {
      const byok: CreateDeployDto = {
        bot_token: '123456:abc',
        llm_provider: 'custom',
        llm_key: 'sk-secret',
        llm_base_url: 'https://llm.example.com/v1',
        llm_model: 'my-model',
      };

      await service.create(USER, byok);

      const data = prisma.deploy.create.mock.calls[0][0].data;
      expect(data.llm_provider).toBe('custom');
      expect(data.llm_base_url).toBe('https://llm.example.com/v1');
      expect(data.llm_model).toBe('my-model');
      expect(secrets.decrypt(data.llm_key_enc)).toBe('sk-secret');
      const serialized = JSON.stringify(data, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      );
      expect(serialized).not.toContain('sk-secret');
    });
  });

  it('upserts the user before creating the deploy (FK safety)', async () => {
    await service.create(USER, { bot_token: '123456:abc' });
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { telegram_id: 12345n },
      create: { telegram_id: 12345n, username: 'alice' },
      update: {},
    });
  });

  const dbRow = {
    id: 'deploy-1',
    agent: 'hermes',
    bot_username: 'mybot',
    llm_provider: 'openrouter',
    status: 'ready',
    vm_ip: '1.2.3.4',
    hostinger_vm_id: '777',
    llm_base_url: null,
    llm_model: null,
    created_at: new Date('2026-07-04T10:00:00Z'),
    updated_at: new Date('2026-07-04T10:05:00Z'),
    bot_token_enc: 'v1:secret',
    llm_key_enc: 'v1:secret',
    bot_token_status: null,
    user_id: 12345n,
  };

  it('lists the caller deploys as secret-free views', async () => {
    prisma.deploy.findMany.mockResolvedValue([dbRow]);

    const views = await service.list(USER);

    expect(prisma.deploy.findMany).toHaveBeenCalledWith({
      where: { user_id: 12345n },
      orderBy: { created_at: 'desc' },
    });
    expect(views).toEqual([
      {
        id: 'deploy-1',
        agent: 'hermes',
        bot_username: 'mybot',
        llm_provider: 'openrouter',
        status: 'ready',
        vm_ip: '1.2.3.4',
        bot_token_status: null,
        created_at: '2026-07-04T10:00:00.000Z',
        updated_at: '2026-07-04T10:05:00.000Z',
      },
    ]);
    const serialized = JSON.stringify(views);
    expect(serialized).not.toContain('bot_token_enc');
    expect(serialized).not.toContain('secret');
  });

  it('returns a single owned deploy view', async () => {
    prisma.deploy.findUnique.mockResolvedValue(dbRow);
    const view = await service.getById(USER, 'deploy-1');
    expect(view.id).toBe('deploy-1');
    expect(view).not.toHaveProperty('bot_token_enc');
  });

  it('404s when the deploy does not exist', async () => {
    prisma.deploy.findUnique.mockResolvedValue(null);
    await expect(service.getById(USER, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when the deploy belongs to another user', async () => {
    prisma.deploy.findUnique.mockResolvedValue({ ...dbRow, user_id: 99999n });
    await expect(service.getById(USER, 'deploy-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('enqueues a teardown job for an owned, non-deleted deploy', async () => {
    prisma.deploy.findUnique.mockResolvedValue(dbRow);
    const view = await service.requestTeardown(USER, 'deploy-1');
    expect(teardownQueue.enqueueTeardown).toHaveBeenCalledWith({ deployId: 'deploy-1' });
    expect(view.id).toBe('deploy-1');
  });

  it('does not enqueue teardown for an already-deleted deploy (idempotent)', async () => {
    prisma.deploy.findUnique.mockResolvedValue({ ...dbRow, status: 'deleted' });
    await service.requestTeardown(USER, 'deploy-1');
    expect(teardownQueue.enqueueTeardown).not.toHaveBeenCalled();
  });

  it('404s teardown for a deploy owned by another user', async () => {
    prisma.deploy.findUnique.mockResolvedValue({ ...dbRow, user_id: 99999n });
    await expect(service.requestTeardown(USER, 'deploy-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(teardownQueue.enqueueTeardown).not.toHaveBeenCalled();
  });

  describe('restart', () => {
    it('restarts the docker project of an owned, ready deploy and logs it', async () => {
      prisma.deploy.findUnique.mockResolvedValue(dbRow);

      const result = await service.restart(USER, 'deploy-1');

      expect(result).toEqual({ ok: true });
      expect(provisioning.restartDockerProject).toHaveBeenCalledWith(777, 'hermes-deploy-1');
      expect(prisma.provisioningLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deploy_id: 'deploy-1',
          step: 'restart',
          status: 'success',
        }),
      });
    });

    it('404s restart for a deploy owned by another user', async () => {
      prisma.deploy.findUnique.mockResolvedValue({ ...dbRow, user_id: 99999n });
      await expect(service.restart(USER, 'deploy-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(provisioning.restartDockerProject).not.toHaveBeenCalled();
    });

    it('409s restart when the deploy is not ready', async () => {
      prisma.deploy.findUnique.mockResolvedValue({ ...dbRow, status: 'configuring' });
      await expect(service.restart(USER, 'deploy-1')).rejects.toBeInstanceOf(ConflictException);
      expect(provisioning.restartDockerProject).not.toHaveBeenCalled();
    });
  });

  describe('updateLlmKey', () => {
    const KEY_DTO = { provider_id: 'openrouter', api_key: 'sk-new' };
    function readyRow() {
      return { ...dbRow, bot_token_enc: secrets.encrypt('123456:botsecret') };
    }

    it('validates the key, re-encrypts it, updates the row and re-pushes the project', async () => {
      prisma.deploy.findUnique.mockResolvedValue(readyRow());

      const result = await service.updateLlmKey(USER, 'deploy-1', KEY_DTO);

      expect(result).toEqual({ ok: true });
      expect(validateLlmKey.validate).toHaveBeenCalledWith(KEY_DTO);

      const updateData = prisma.deploy.update.mock.calls[0][0].data;
      expect(updateData.llm_provider).toBe('openrouter');
      expect(secrets.decrypt(updateData.llm_key_enc)).toBe('sk-new');

      expect(provisioning.updateDockerProject).toHaveBeenCalledTimes(1);
      const [vmId, projectName, compose, env] = provisioning.updateDockerProject.mock.calls[0];
      expect(vmId).toBe(777);
      expect(projectName).toBe('hermes-deploy-1');
      expect(compose).toContain('nousresearch/hermes-agent');
      expect(env).toContain('OPENROUTER_API_KEY=sk-new');
      const logMessage = prisma.provisioningLog.create.mock.calls[0][0].data.message;
      expect(logMessage).not.toContain('sk-new');
    });

    it('422s and does not touch the DB or VM when the key is invalid', async () => {
      prisma.deploy.findUnique.mockResolvedValue(readyRow());
      validateLlmKey.validate.mockRejectedValue(new UnprocessableEntityException());

      await expect(service.updateLlmKey(USER, 'deploy-1', KEY_DTO)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(prisma.deploy.update).not.toHaveBeenCalled();
      expect(provisioning.updateDockerProject).not.toHaveBeenCalled();
    });

    it('404s for a deploy owned by another user (no key probe)', async () => {
      prisma.deploy.findUnique.mockResolvedValue({ ...readyRow(), user_id: 99999n });
      await expect(service.updateLlmKey(USER, 'deploy-1', KEY_DTO)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(validateLlmKey.validate).not.toHaveBeenCalled();
    });

    it('409s when the deploy is not ready', async () => {
      prisma.deploy.findUnique.mockResolvedValue({ ...readyRow(), status: 'configuring' });
      await expect(service.updateLlmKey(USER, 'deploy-1', KEY_DTO)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(validateLlmKey.validate).not.toHaveBeenCalled();
      expect(provisioning.updateDockerProject).not.toHaveBeenCalled();
    });
  });

  describe('updateBotToken', () => {
    function readyRow() {
      return {
        ...dbRow,
        bot_token_enc: secrets.encrypt('123456:oldtoken'),
        llm_key_enc: secrets.encrypt('sk-or-existing'),
      };
    }

    it('validates the new token (excluding self), re-encrypts it, re-pushes the project', async () => {
      prisma.deploy.findUnique.mockResolvedValue(readyRow());
      validateBotToken.validate.mockResolvedValue({ username: 'newbot', id: 8 });

      const result = await service.updateBotToken(USER, 'deploy-1', {
        bot_token: '123456:newtoken',
      });

      expect(result).toEqual({ ok: true });
      expect(validateBotToken.validate).toHaveBeenCalledWith('123456:newtoken', 'deploy-1');

      const updateData = prisma.deploy.update.mock.calls[0][0].data;
      expect(secrets.decrypt(updateData.bot_token_enc)).toBe('123456:newtoken');
      expect(updateData.bot_username).toBe('newbot');
      expect(updateData.bot_token_status).toBe('valid');

      const [vmId, projectName, compose, env] = provisioning.updateDockerProject.mock.calls[0];
      expect(vmId).toBe(777);
      expect(projectName).toBe('hermes-deploy-1');
      expect(env).toContain('TELEGRAM_BOT_TOKEN=123456:newtoken');
      expect(env).toContain('OPENROUTER_API_KEY=sk-or-existing');
      expect(compose).not.toContain('123456:newtoken');
      const logMessage = prisma.provisioningLog.create.mock.calls[0][0].data.message;
      expect(logMessage).not.toContain('123456:newtoken');
    });

    it('422s and does not touch the DB or VM when the new token is invalid', async () => {
      prisma.deploy.findUnique.mockResolvedValue(readyRow());
      validateBotToken.validate.mockRejectedValue(new UnprocessableEntityException());

      await expect(
        service.updateBotToken(USER, 'deploy-1', { bot_token: 'bad' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(prisma.deploy.update).not.toHaveBeenCalled();
      expect(provisioning.updateDockerProject).not.toHaveBeenCalled();
    });

    it('404s for a deploy owned by another user (no token probe)', async () => {
      prisma.deploy.findUnique.mockResolvedValue({ ...readyRow(), user_id: 99999n });
      await expect(
        service.updateBotToken(USER, 'deploy-1', { bot_token: '123456:newtoken' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(validateBotToken.validate).not.toHaveBeenCalled();
    });

    it('409s when the deploy is not ready', async () => {
      prisma.deploy.findUnique.mockResolvedValue({ ...readyRow(), status: 'configuring' });
      await expect(
        service.updateBotToken(USER, 'deploy-1', { bot_token: '123456:newtoken' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(validateBotToken.validate).not.toHaveBeenCalled();
    });

    it('409s when the deploy has no llm key to re-render', async () => {
      prisma.deploy.findUnique.mockResolvedValue({ ...readyRow(), llm_key_enc: null });
      validateBotToken.validate.mockResolvedValue({ username: 'newbot', id: 8 });
      await expect(
        service.updateBotToken(USER, 'deploy-1', { bot_token: '123456:newtoken' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(provisioning.updateDockerProject).not.toHaveBeenCalled();
    });
  });

  describe('getLiveStatus', () => {
    it('returns the live VM state and containers of an owned deploy', async () => {
      prisma.deploy.findUnique.mockResolvedValue(dbRow);

      const result = await service.getLiveStatus(USER, 'deploy-1');

      expect(provisioning.getVM).toHaveBeenCalledWith(777);
      expect(provisioning.getDockerProjectContainers).toHaveBeenCalledWith(777, 'hermes-deploy-1');
      expect(result).toEqual({
        vm_state: 'running',
        vm_ip: '1.2.3.4',
        containers: [
          expect.objectContaining({ name: 'hermes-hermes-1', state: 'running', health: 'healthy' }),
        ],
        checked_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });

    it('returns nulls without calling Hostinger when the VM is not created yet', async () => {
      prisma.deploy.findUnique.mockResolvedValue({
        ...dbRow,
        status: 'pending',
        hostinger_vm_id: null,
        vm_ip: null,
      });

      const result = await service.getLiveStatus(USER, 'deploy-1');

      expect(result.vm_state).toBeNull();
      expect(result.containers).toEqual([]);
      expect(provisioning.getVM).not.toHaveBeenCalled();
      expect(provisioning.getDockerProjectContainers).not.toHaveBeenCalled();
    });

    it('tolerates a vanished VM (Hostinger 404 → null state, containers still returned)', async () => {
      prisma.deploy.findUnique.mockResolvedValue(dbRow);
      provisioning.getVM.mockRejectedValue({ response: { status: 404 } });

      const result = await service.getLiveStatus(USER, 'deploy-1');

      expect(result.vm_state).toBeNull();
      expect(result.vm_ip).toBe('1.2.3.4');
      expect(result.containers).toHaveLength(1);
    });

    it('tolerates a project that is not visible yet (404/422 → empty containers)', async () => {
      prisma.deploy.findUnique.mockResolvedValue(dbRow);
      provisioning.getDockerProjectContainers.mockRejectedValue({ response: { status: 404 } });

      const result = await service.getLiveStatus(USER, 'deploy-1');

      expect(result.vm_state).toBe('running');
      expect(result.containers).toEqual([]);
    });

    it('propagates unexpected Hostinger errors', async () => {
      prisma.deploy.findUnique.mockResolvedValue(dbRow);
      provisioning.getVM.mockRejectedValue({ response: { status: 500 } });

      await expect(service.getLiveStatus(USER, 'deploy-1')).rejects.toEqual({
        response: { status: 500 },
      });
    });

    it('404s for a deploy owned by another user (no Hostinger calls)', async () => {
      prisma.deploy.findUnique.mockResolvedValue({ ...dbRow, user_id: 99999n });

      await expect(service.getLiveStatus(USER, 'deploy-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(provisioning.getVM).not.toHaveBeenCalled();
      expect(provisioning.getDockerProjectContainers).not.toHaveBeenCalled();
    });
  });
});
