import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser, TopupTier } from '@hermes/shared';
import { TopupService, parseTopupTiers } from './topup.service';

const USER: AuthenticatedUser = { telegram_id: '12345', username: 'alice' };
const KEY_HASH = 'or-key-hash';
const TIERS: TopupTier[] = [
  { amount_usd: 10, channel_id: '-100000000001', subscribe_url: 'https://t.me/tribute/+10' },
  { amount_usd: 50, channel_id: '-100000000002', subscribe_url: 'https://t.me/tribute/+50' },
];

describe('parseTopupTiers', () => {
  it('returns an empty list when unset', () => {
    expect(parseTopupTiers(undefined)).toEqual([]);
    expect(parseTopupTiers('')).toEqual([]);
  });

  it('parses a valid JSON tier array', () => {
    const raw = JSON.stringify(TIERS);
    expect(parseTopupTiers(raw)).toEqual(TIERS);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseTopupTiers('{bad')).toThrow('not valid JSON');
  });

  it('throws on a tier missing a required field', () => {
    const raw = JSON.stringify([{ amount_usd: 10, channel_id: '-100' }]);
    expect(() => parseTopupTiers(raw)).toThrow('TOPUP_TIERS invalid');
  });
});

describe('TopupService', () => {
  let prisma: { deploy: { findUnique: jest.Mock }; provisioningLog: { create: jest.Mock } };
  let openRouterKeys: { getKey: jest.Mock; raiseLimit: jest.Mock };
  let bot: { getChatMember: jest.Mock };
  let service: TopupService;

  function makeService(tiers: TopupTier[] = TIERS, markup = 25): TopupService {
    return new TopupService(prisma as never, openRouterKeys as never, bot as never, tiers, markup);
  }

  beforeEach(() => {
    prisma = {
      deploy: { findUnique: jest.fn().mockResolvedValue(null) },
      provisioningLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    openRouterKeys = {
      getKey: jest.fn().mockResolvedValue({ hash: KEY_HASH, name: null, limit: 40, limit_reset: 'monthly', disabled: false, usage: 12.5 }),
      raiseLimit: jest.fn().mockResolvedValue(undefined),
    };
    bot = { getChatMember: jest.fn().mockResolvedValue({ status: 'member' }) };
    service = makeService();
  });

  function makeDeploy(overrides: Record<string, unknown> = {}) {
    return {
      id: 'deploy-1',
      user_id: 12345n,
      status: 'ready',
      openrouter_key_hash: KEY_HASH,
      ...overrides,
    };
  }

  describe('listTiers', () => {
    it('exposes tiers with the +25% markup price, sorted by amount, without the channel id', () => {
      const views = service.listTiers();
      expect(views).toEqual([
        { amount_usd: 10, price_usd: 12.5, subscribe_url: 'https://t.me/tribute/+10' },
        { amount_usd: 50, price_usd: 62.5, subscribe_url: 'https://t.me/tribute/+50' },
      ]);
      expect(views.every((v) => !('channel_id' in v))).toBe(true);
    });

    it('returns an empty list when no tiers are configured', () => {
      service = makeService([]);
      expect(service.listTiers()).toEqual([]);
    });
  });

  describe('topup', () => {
    it('checks tier membership and raises the cap by the tier amount', async () => {
      prisma.deploy.findUnique.mockResolvedValue(makeDeploy());

      const result = await service.topup(USER, { deploy_id: 'deploy-1', amount_usd: 10 });

      expect(bot.getChatMember).toHaveBeenCalledWith(-100000000001n, 12345n);
      expect(openRouterKeys.getKey).toHaveBeenCalledWith(KEY_HASH);
      expect(openRouterKeys.raiseLimit).toHaveBeenCalledWith(KEY_HASH, 50);
      expect(result).toEqual({ ok: true, new_limit_usd: 50 });
      expect(prisma.provisioningLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ deploy_id: 'deploy-1', step: 'topup', status: 'success' }),
      });
    });

    it('adds to whatever the current cap is', async () => {
      prisma.deploy.findUnique.mockResolvedValue(makeDeploy());
      openRouterKeys.getKey.mockResolvedValue({ limit: 50 });

      const result = await service.topup(USER, { deploy_id: 'deploy-1', amount_usd: 50 });

      expect(openRouterKeys.raiseLimit).toHaveBeenCalledWith(KEY_HASH, 100);
      expect(result.new_limit_usd).toBe(100);
    });

    it('404s when the deploy is not owned by the caller', async () => {
      prisma.deploy.findUnique.mockResolvedValue(makeDeploy({ user_id: 99999n }));
      await expect(service.topup(USER, { deploy_id: 'deploy-1', amount_usd: 10 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(bot.getChatMember).not.toHaveBeenCalled();
    });

    it('404s when the deploy does not exist', async () => {
      prisma.deploy.findUnique.mockResolvedValue(null);
      await expect(service.topup(USER, { deploy_id: 'gone', amount_usd: 10 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('409s when the deploy is not ready', async () => {
      prisma.deploy.findUnique.mockResolvedValue(makeDeploy({ status: 'configuring' }));
      await expect(service.topup(USER, { deploy_id: 'deploy-1', amount_usd: 10 })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('400s when the deploy has no managed key', async () => {
      prisma.deploy.findUnique.mockResolvedValue(makeDeploy({ openrouter_key_hash: null }));
      await expect(service.topup(USER, { deploy_id: 'deploy-1', amount_usd: 10 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('400s on an unknown tier amount', async () => {
      prisma.deploy.findUnique.mockResolvedValue(makeDeploy());
      await expect(
        service.topup(USER, { deploy_id: 'deploy-1', amount_usd: 7 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(bot.getChatMember).not.toHaveBeenCalled();
    });

    it('402s when the user is not a member of the tier channel', async () => {
      prisma.deploy.findUnique.mockResolvedValue(makeDeploy());
      bot.getChatMember.mockResolvedValue({ status: 'left' });

      await expect(service.topup(USER, { deploy_id: 'deploy-1', amount_usd: 10 })).rejects.toMatchObject({
        status: 402,
      });
      expect(openRouterKeys.raiseLimit).not.toHaveBeenCalled();
    });

    it('402s when the entry bot is disabled (getChatMember null)', async () => {
      prisma.deploy.findUnique.mockResolvedValue(makeDeploy());
      bot.getChatMember.mockResolvedValue(null);

      await expect(service.topup(USER, { deploy_id: 'deploy-1', amount_usd: 10 })).rejects.toMatchObject({
        status: 402,
      });
      expect(openRouterKeys.raiseLimit).not.toHaveBeenCalled();
    });
  });
});
