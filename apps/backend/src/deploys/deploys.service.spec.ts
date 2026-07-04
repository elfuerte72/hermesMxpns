import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { AuthenticatedUser } from '@hermes/shared';
import { DeploysService } from './deploys.service';
import { SecretsService } from '../secrets/secrets.service';
import { hashBootstrapToken } from './bootstrap-token';
import type { CreateDeployDto } from './create-deploy.dto';

const USER: AuthenticatedUser = { telegram_id: '12345', username: 'alice' };
const DTO: CreateDeployDto = { bot_token: '123456:abc', llm_provider: 'groq', llm_key: 'sk-secret' };
// 32-byte test key (64 hex) — real AES-256-GCM encryption in the assertions below.
const TEST_KEY = 'a'.repeat(64);

describe('DeploysService', () => {
  let prisma: {
    user: { upsert: jest.Mock };
    deploy: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
  };
  let secrets: SecretsService;
  let validateBotToken: { validate: jest.Mock };
  let queue: { enqueueDeploy: jest.Mock };
  let service: DeploysService;

  beforeEach(() => {
    prisma = {
      user: { upsert: jest.fn().mockResolvedValue(undefined) },
      deploy: {
        create: jest.fn().mockResolvedValue({ id: 'deploy-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    secrets = new SecretsService(TEST_KEY);
    validateBotToken = { validate: jest.fn().mockResolvedValue({ username: 'mybot', id: 7 }) };
    queue = { enqueueDeploy: jest.fn().mockResolvedValue(undefined) };
    service = new DeploysService(
      prisma as never,
      secrets,
      validateBotToken as never,
      queue as never,
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

  it('stores only the bootstrap token hash, passing the plaintext to the queue', async () => {
    await service.create(USER, DTO);

    const storedHash = prisma.deploy.create.mock.calls[0][0].data.bootstrap_token_hash;
    const jobData = queue.enqueueDeploy.mock.calls[0][0];

    expect(jobData.deployId).toBe('deploy-1');
    expect(jobData.bootstrapToken).toMatch(/^[0-9a-f]{64}$/);
    // The hash in the DB must correspond to the plaintext handed to the worker...
    expect(hashBootstrapToken(jobData.bootstrapToken)).toBe(storedHash);
    // ...and the plaintext token must never be persisted.
    expect(storedHash).not.toBe(jobData.bootstrapToken);
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
    created_at: new Date('2026-07-04T10:00:00Z'),
    updated_at: new Date('2026-07-04T10:05:00Z'),
    // Secret columns that must NOT appear in the view:
    bot_token_enc: 'v1:secret',
    llm_key_enc: 'v1:secret',
    bootstrap_token_hash: 'hash',
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
});
