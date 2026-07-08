import type { AuthenticatedUser } from '@hermes/shared';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

describe('SubscriptionController', () => {
  let controller: SubscriptionController;
  let service: { getStatus: jest.Mock; checkStatus: jest.Mock };

  beforeEach(() => {
    service = {
      getStatus: jest.fn(),
      checkStatus: jest.fn(),
    };
    controller = new SubscriptionController(service as unknown as SubscriptionService);
  });

  it('GET /subscription/status delegates to service.getStatus', async () => {
    const user: AuthenticatedUser = { telegram_id: '42', username: 'bob' };
    service.getStatus.mockResolvedValue({ subscription_status: 'active', subscription_until: null });

    const result = await controller.status(user);

    expect(service.getStatus).toHaveBeenCalledWith(user);
    expect(result).toEqual({ subscription_status: 'active', subscription_until: null });
  });

  it('POST /subscription/check delegates to service.checkStatus', async () => {
    const user: AuthenticatedUser = { telegram_id: '42', username: 'bob' };
    service.checkStatus.mockResolvedValue({ subscription_status: 'none', subscription_until: null });

    const result = await controller.check(user);

    expect(service.checkStatus).toHaveBeenCalledWith(user);
    expect(result).toEqual({ subscription_status: 'none', subscription_until: null });
  });
});
