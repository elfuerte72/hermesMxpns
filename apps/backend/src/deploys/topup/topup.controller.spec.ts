import type { AuthenticatedUser, TopupTierView } from '@hermes/shared';
import { TopupController } from './topup.controller';
import { TopupService } from './topup.service';
import type { TopupDto } from './topup.dto';

describe('TopupController', () => {
  let service: { listTiers: jest.Mock; topup: jest.Mock };
  let controller: TopupController;

  beforeEach(() => {
    service = { listTiers: jest.fn(), topup: jest.fn() };
    controller = new TopupController(service as unknown as TopupService);
  });

  it('GET /deploys/topup/tiers delegates to listTiers', () => {
    const tiers: TopupTierView[] = [
      { amount_usd: 10, price_usd: 12.5, subscribe_url: 'https://t.me/tribute/+10' },
    ];
    service.listTiers.mockReturnValue(tiers);

    expect(controller.tiers()).toEqual(tiers);
  });

  it('POST /deploys/topup delegates the user and dto to topup', async () => {
    const user: AuthenticatedUser = { telegram_id: '42', username: 'bob' };
    const dto: TopupDto = { deploy_id: 'd-1', amount_usd: 10 };
    service.topup.mockResolvedValue({ ok: true, new_limit_usd: 50 });

    const result = await controller.topup(user, dto);

    expect(service.topup).toHaveBeenCalledWith(user, dto);
    expect(result).toEqual({ ok: true, new_limit_usd: 50 });
  });
});
