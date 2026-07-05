import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { AuthenticatedUser } from '@hermes/shared';
import { DeploysService } from './deploys.service';
import { SecretsService } from '../secrets/secrets.service';
import type { CreateDeployDto } from './create-deploy.dto';

const USER: AuthenticatedUser = { telegram_id: '12345', username: 'alice' };
const DTO: CreateDeployDto = {
  bot_token: '123456:abc',
  llm_provider: 'groq',
  llm_key: 'sk-secret',
};
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
  let provisioning: { restartDockerProject: jest.Mock; updateDockerProject: jest.Mock };
  let validateLlmKey: { validate: jest.Mock };
  let service: DeploysService;

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
    };
    validateLlmKey = { validate: jest.fn().mockResolvedValue({ ok: true }) };
    service = new DeploysService(
      prisma as never,
      secrets,
      validateBotToken as never,
      queue as never,
      teardownQueue as never,
      provisioning as never,
      validateLlmKey as never,
    );
  });

  it('validates the bot token, persists a pending deploy and enqueues the job', async () => {
    const result = await service.create(USER, DTO);

    expect(validateBotToken.validate).toHaveBeenCalledWith('123456:abc');
    expect(result).toEqual({ deploy_id: 'deploy-1', status: 'pending' });
    expect(queue.enqueueDeploy).toHaveBeenCalledTimes(1);
  });

  it('upserts the user before creating the deploy (FK safety)', async () => {
    await service.create(USER, DTO);
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { telegram_id: 12345n },
      create: { telegram_id: 12345n, username: 'alice' },
      update: {},
    });
  });

  it('stores only encrypted secrets — never the plaintext token or key', async () => {
    await service.create(USER, DTO);

    const data = prisma.deploy.create.mock.calls[0][0].data;
    // Persisted columns are ciphertext that round-trips back to the plaintext.
    expect(secrets.decrypt(data.bot_token_enc)).toBe('123456:abc');
    expect(secrets.decrypt(data.llm_key_enc)).toBe('sk-secret');
    expect(data.bot_username).toBe('mybot');
    expect(data.user_id).toBe(12345n);
    // No plaintext leaks into the persisted row (real ciphertext, so a true check).
    const serialized = JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(serialized).not.toContain('sk-secret');
    expect(serialized).not.toContain('123456:abc');
    // No accidental plaintext columns.
    expect(data).not.toHaveProperty('bot_token');
    expect(data).not.toHaveProperty('llm_key');
  });

  it('enqueues only the deploy id — no secrets in the job payload', async () => {
    await service.create(USER, DTO);
    expect(queue.enqueueDeploy).toHaveBeenCalledWith({ deployId: 'deploy-1' });
  });

  it('persists the custom provider base_url and model', async () => {
    const customDto: CreateDeployDto = {
      bot_token: '123456:abc',
      llm_provider: 'custom',
      llm_key: 'sk-secret',
      llm_base_url: 'https://llm.example.com/v1',
      llm_model: 'my-model',
    };
    await service.create(USER, customDto);
    const data = prisma.deploy.create.mock.calls[0][0].data;
    expect(data.llm_base_url).toBe('https://llm.example.com/v1');
    expect(data.llm_model).toBe('my-model');
  });

  it('defaults base_url/model to null for catalog providers', async () => {
    await service.create(USER, DTO);
    const data = prisma.deploy.create.mock.calls[0][0].data;
    expect(data.llm_base_url).toBeNull();
    expect(data.llm_model).toBeNull();
  });

  it('does not create a deploy or enqueue when the bot token is invalid (422)', async () => {
    validateBotToken.validate.mockRejectedValue(new UnprocessableEntityException());

    await expect(service.create(USER, DTO)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.deploy.create).not.toHaveBeenCalled();
    expect(queue.enqueueDeploy).not.toHaveBeenCalled();
  });

  it('propagates a 409 when the bot is already used by an active deploy', async () => {
    validateBotToken.validate.mockRejectedValue(new ConflictException());

    await expect(service.create(USER, DTO)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.deploy.create).not.toHaveBeenCalled();
    expect(queue.enqueueDeploy).not.toHaveBeenCalled();
  });

  const dbRow = {
    id: 'deploy-1',
    agent: 'hermes',
    bot_username: 'mybot',
    llm_provider: 'groq',
    status: 'ready',
    vm_ip: '1.2.3.4',
    hostinger_vm_id: '777',
    llm_base_url: null,
    llm_model: null,
    created_at: new Date('2026-07-04T10:00:00Z'),
    updated_at: new Date('2026-07-04T10:05:00Z'),
    // Secret columns that must NOT appear in the view:
    bot_token_enc: 'v1:secret',
    llm_key_enc: 'v1:secret',
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
        llm_provider: 'groq',
        status: 'ready',
        vm_ip: '1.2.3.4',
        created_at: '2026-07-04T10:00:00.000Z',
        updated_at: '2026-07-04T10:05:00.000Z',
      },
    ]);
    // No secret keys leak into the view.
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
        data: expect.objectContaining({ deploy_id: 'deploy-1', step: 'restart', status: 'success' }),
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
    const KEY_DTO = { provider_id: 'groq', api_key: 'sk-new' };
    // A ready deploy row with a genuinely-encrypted bot token so the re-render decrypts.
    function readyRow() {
      return { ...dbRow, bot_token_enc: secrets.encrypt('123456:botsecret') };
    }

    it('validates the key, re-encrypts it, updates the row and re-pushes the project', async () => {
      prisma.deploy.findUnique.mockResolvedValue(readyRow());

      const result = await service.updateLlmKey(USER, 'deploy-1', KEY_DTO);

      expect(result).toEqual({ ok: true });
      expect(validateLlmKey.validate).toHaveBeenCalledWith(KEY_DTO);

      const updateData = prisma.deploy.update.mock.calls[0][0].data;
      expect(updateData.llm_provider).toBe('groq');
      expect(secrets.decrypt(updateData.llm_key_enc)).toBe('sk-new');

      expect(provisioning.updateDockerProject).toHaveBeenCalledTimes(1);
      const [vmId, projectName, compose, env] = provisioning.updateDockerProject.mock.calls[0];
      expect(vmId).toBe(777);
      expect(projectName).toBe('hermes-deploy-1');
      expect(compose).toContain('nousresearch/hermes-agent');
      expect(env).toContain('GROQ_API_KEY=sk-new');
      // The plaintext key never reaches a provisioning log message.
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
});
