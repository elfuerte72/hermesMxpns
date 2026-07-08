import type { AuthenticatedUser } from '@hermes/shared';
import { SubscriptionService } from './subscription.service';

const USER: AuthenticatedUser = { telegram_id: '12345', username: 'alice' };
const CHANNEL_ID = -1001234567890n;

describe('SubscriptionService', () => {
  let prisma: { deploy: { findFirst: jest.Mock; updateMany: jest.Mock } };
  let bot: { getChatMember: jest.Mock };
  let service: SubscriptionService;

  beforeEach(() => {
    prisma = {
      deploy: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    bot = { getChatMember: jest.fn().mockResolvedValue({ status: 'member' }) };
  });

  function makeService(channelId: bigint | null = CHANNEL_ID): SubscriptionService {
    return new SubscriptionService(prisma as never, bot as never, channelId);
  }

  describe('getStatus (cached)', () => {
    it('returns none when the user has no deploys', async () => {
      service = makeService();
      prisma.deploy.findFirst.mockResolvedValue(null);

      const result = await service.getStatus(USER);

      expect(result).toEqual({ subscription_status: 'none', subscription_until: null });
      expect(bot.getChatMember).not.toHaveBeenCalled();
    });

    it('returns the cached status and until from the most recent deploy', async () => {
      service = makeService();
      const until = new Date('2026-08-01T00:00:00Z');
      prisma.deploy.findFirst.mockResolvedValue({
        subscription_status: 'active',
        subscription_until: until,
      });

      const result = await service.getStatus(USER);

      expect(prisma.deploy.findFirst).toHaveBeenCalledWith({
        where: { user_id: 12345n },
        orderBy: { created_at: 'desc' },
        select: { subscription_status: true, subscription_until: true },
      });
      expect(result).toEqual({
        subscription_status: 'active',
        subscription_until: '2026-08-01T00:00:00.000Z',
      });
    });

    it('treats a null cached status as none', async () => {
      service = makeService();
      prisma.deploy.findFirst.mockResolvedValue({
        subscription_status: null,
        subscription_until: null,
      });

      const result = await service.getStatus(USER);

      expect(result.subscription_status).toBe('none');
      expect(result.subscription_until).toBeNull();
    });
  });

  describe('checkStatus (live)', () => {
    it('returns none and skips both the bot call and the DB write when gating is disabled', async () => {
      service = makeService(null);

      const result = await service.checkStatus(USER);

      expect(result).toEqual({ subscription_status: 'none', subscription_until: null });
      expect(bot.getChatMember).not.toHaveBeenCalled();
      expect(prisma.deploy.updateMany).not.toHaveBeenCalled();
    });

    it('live-checks membership, mirrors it onto every deploy, and returns active', async () => {
      service = makeService();
      bot.getChatMember.mockResolvedValue({ status: 'member' });

      const result = await service.checkStatus(USER);

      expect(bot.getChatMember).toHaveBeenCalledWith(CHANNEL_ID, 12345n);
      expect(prisma.deploy.updateMany).toHaveBeenCalledWith({
        where: { user_id: 12345n },
        data: { subscription_status: 'active', subscription_channel_id: CHANNEL_ID, subscription_expired_at: null },
      });
      expect(result.subscription_status).toBe('active');
    });

    it('maps left/kicked to expired and stamps the expiry time', async () => {
      service = makeService();
      bot.getChatMember.mockResolvedValue({ status: 'left' });

      const result = await service.checkStatus(USER);

      expect(prisma.deploy.updateMany).toHaveBeenCalledWith({
        where: { user_id: 12345n },
        data: { subscription_status: 'expired', subscription_channel_id: CHANNEL_ID, subscription_expired_at: expect.any(Date) },
      });
      expect(result.subscription_status).toBe('expired');
    });

    it('returns none when the entry bot is disabled (getChatMember null)', async () => {
      service = makeService();
      bot.getChatMember.mockResolvedValue(null);

      const result = await service.checkStatus(USER);

      expect(prisma.deploy.updateMany).toHaveBeenCalledWith({
        where: { user_id: 12345n },
        data: { subscription_status: 'none', subscription_channel_id: CHANNEL_ID, subscription_expired_at: null },
      });
      expect(result.subscription_status).toBe('none');
    });
  });
});
