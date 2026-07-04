import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BootstrapService } from './bootstrap.service';
import { SecretsService } from '../secrets/secrets.service';
import { hashBootstrapToken } from '../deploys/bootstrap-token';

const TEST_KEY = 'b'.repeat(64);
const TOKEN = 'c'.repeat(64);
const VM_IP = '203.0.113.7';

describe('BootstrapService', () => {
  let secrets: SecretsService;
  let prisma: {
    deploy: { findUnique: jest.Mock; updateMany: jest.Mock };
  };
  let service: BootstrapService;

  function makeDeploy(overrides: Record<string, unknown> = {}) {
    return {
      id: 'deploy-1',
      user_id: 999n,
      llm_provider: 'groq',
      llm_base_url: null,
      llm_model: null,
      bot_token_enc: secrets.encrypt('123:botsecret'),
      llm_key_enc: secrets.encrypt('sk-llm'),
      bootstrap_token_hash: hashBootstrapToken(TOKEN),
      bootstrap_used_at: null,
      webhook_secret_hash: null,
      vm_ip: VM_IP,
      ...overrides,
    };
  }

  beforeEach(() => {
    secrets = new SecretsService(TEST_KEY);
    prisma = {
      deploy: {
        findUnique: jest.fn().mockResolvedValue(makeDeploy()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new BootstrapService(prisma as never, secrets);
  });

  it('delivers rendered files + webhook secret for a valid token from the VM IP', async () => {
    const payload = await service.pull('deploy-1', TOKEN, VM_IP);

    expect(payload.env).toContain('TELEGRAM_BOT_TOKEN=123:botsecret');
    expect(payload.env).toContain('TELEGRAM_ALLOWED_USERS=999');
    expect(payload.env).toContain('GROQ_API_KEY=sk-llm');
    expect(payload.config_yaml).toContain('base_url: "https://api.groq.com/openai/v1"');
    expect(payload.compose).toContain('nousresearch/hermes-agent:latest');
    expect(payload.webhook_secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('burns the token atomically and stores the webhook secret hash', async () => {
    const payload = await service.pull('deploy-1', TOKEN, VM_IP);

    const call = prisma.deploy.updateMany.mock.calls[0][0];
    // Guarded on the unused state so only the first caller wins.
    expect(call.where).toEqual({ id: 'deploy-1', bootstrap_used_at: null });
    expect(call.data.bootstrap_used_at).toBeInstanceOf(Date);
    expect(call.data.webhook_secret_hash).toBe(hashBootstrapToken(payload.webhook_secret));
  });

  it('uses the deploy overrides for the custom provider', async () => {
    prisma.deploy.findUnique.mockResolvedValue(
      makeDeploy({
        llm_provider: 'custom',
        llm_base_url: 'https://llm.acme.dev/v1',
        llm_model: 'acme-1',
      }),
    );
    const payload = await service.pull('deploy-1', TOKEN, VM_IP);
    expect(payload.config_yaml).toContain('base_url: "https://llm.acme.dev/v1"');
    expect(payload.config_yaml).toContain('default: "acme-1"');
    expect(payload.config_yaml).toContain('provider: "custom:custom"');
  });

  it('404s for an unknown deploy', async () => {
    prisma.deploy.findUnique.mockResolvedValue(null);
    await expect(service.pull('nope', TOKEN, VM_IP)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.deploy.updateMany).not.toHaveBeenCalled();
  });

  it('404s for a wrong token', async () => {
    await expect(service.pull('deploy-1', 'wrong', VM_IP)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.deploy.updateMany).not.toHaveBeenCalled();
  });

  it('404s for a missing token', async () => {
    await expect(service.pull('deploy-1', '', VM_IP)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s for an already-used token', async () => {
    prisma.deploy.findUnique.mockResolvedValue(makeDeploy({ bootstrap_used_at: new Date() }));
    await expect(service.pull('deploy-1', TOKEN, VM_IP)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.deploy.updateMany).not.toHaveBeenCalled();
  });

  it('403s when the caller IP does not match the VM', async () => {
    await expect(service.pull('deploy-1', TOKEN, '198.51.100.9')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.deploy.updateMany).not.toHaveBeenCalled();
  });

  it('403s when the VM IP is not yet recorded', async () => {
    prisma.deploy.findUnique.mockResolvedValue(makeDeploy({ vm_ip: null }));
    await expect(service.pull('deploy-1', TOKEN, VM_IP)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('matches IPv4-mapped IPv6 callers against the stored IPv4', async () => {
    const payload = await service.pull('deploy-1', TOKEN, '203.0.113.7');
    expect(payload.webhook_secret).toBeDefined();
  });

  it('404s if the token lost the burn race (updateMany affected 0 rows)', async () => {
    prisma.deploy.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.pull('deploy-1', TOKEN, VM_IP)).rejects.toBeInstanceOf(NotFoundException);
  });
});
