import { SubscriptionExpiryService } from './subscription-expiry.service';

describe('SubscriptionExpiryService', () => {
  let prisma: { deploy: { findMany: jest.Mock } };
  let teardownQueue: { enqueueTeardown: jest.Mock };
  let service: SubscriptionExpiryService;

  function makeService(graceDays = 7, dryRun = false): SubscriptionExpiryService {
    return new SubscriptionExpiryService(prisma as never, teardownQueue as never, {
      graceDays,
      dryRun,
    });
  }

  beforeEach(() => {
    prisma = { deploy: { findMany: jest.fn().mockResolvedValue([]) } };
    teardownQueue = { enqueueTeardown: jest.fn().mockResolvedValue(undefined) };
    service = makeService();
  });

  it('skips under DRY_RUN and makes no queries', async () => {
    const result = await makeService(7, true).checkOnce();
    expect(result).toEqual({ scheduled: 0 });
    expect(prisma.deploy.findMany).not.toHaveBeenCalled();
    expect(teardownQueue.enqueueTeardown).not.toHaveBeenCalled();
  });

  it('does nothing when graceDays is zero (teardown immediately on expiry is off)', async () => {
    const result = await makeService(0).checkOnce();
    expect(result).toEqual({ scheduled: 0 });
    expect(prisma.deploy.findMany).not.toHaveBeenCalled();
  });

  it('schedules teardown for every expired-past-grace deploy', async () => {
    prisma.deploy.findMany.mockResolvedValue([{ id: 'd-1' }, { id: 'd-2' }]);

    const result = await service.checkOnce();

    expect(result).toEqual({ scheduled: 2 });
    expect(teardownQueue.enqueueTeardown).toHaveBeenCalledWith({ deployId: 'd-1' });
    expect(teardownQueue.enqueueTeardown).toHaveBeenCalledWith({ deployId: 'd-2' });
  });

  it('queries only expired deploys past the cutoff, excluding deleted ones', async () => {
    await service.checkOnce();
    const call = prisma.deploy.findMany.mock.calls[0][0];
    expect(call.where.subscription_status).toBe('expired');
    expect(call.where.status).toEqual({ not: 'deleted' });
    expect(call.where.subscription_expired_at).toEqual({ lt: expect.any(Date) });
    // The cutoff is ~7 days ago.
    const cutoff = call.where.subscription_expired_at.lt as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThan(6 * 86_400_000);
    expect(call.select).toEqual({ id: true });
  });

  it('schedules nothing when no deploys are expired past grace', async () => {
    prisma.deploy.findMany.mockResolvedValue([]);
    const result = await service.checkOnce();
    expect(result).toEqual({ scheduled: 0 });
    expect(teardownQueue.enqueueTeardown).not.toHaveBeenCalled();
  });

  it('uses the configured grace window for the cutoff', async () => {
    service = makeService(30);
    await service.checkOnce();
    const cutoff = prisma.deploy.findMany.mock.calls[0][0].where.subscription_expired_at.lt as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThan(29 * 86_400_000);
  });
});
