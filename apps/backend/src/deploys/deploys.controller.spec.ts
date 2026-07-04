import type { AuthenticatedUser } from '@hermes/shared';
import { DeploysController } from './deploys.controller';
import { DeploysService } from './deploys.service';
import type { CreateDeployDto } from './create-deploy.dto';

describe('DeploysController', () => {
  let controller: DeploysController;
  let service: { create: jest.Mock; list: jest.Mock; getById: jest.Mock };

  beforeEach(() => {
    service = { create: jest.fn(), list: jest.fn(), getById: jest.fn() };
    controller = new DeploysController(service as unknown as DeploysService);
  });

  it('POST /deploys delegates the current user and dto to the service', async () => {
    const user: AuthenticatedUser = { telegram_id: '42', username: 'bob' };
    const dto: CreateDeployDto = { bot_token: '1:a', llm_provider: 'groq', llm_key: 'k' };
    service.create.mockResolvedValue({ deploy_id: 'd-1', status: 'pending' });

    const result = await controller.create(user, dto);

    expect(service.create).toHaveBeenCalledWith(user, dto);
    expect(result).toEqual({ deploy_id: 'd-1', status: 'pending' });
  });

  it('GET /deploys delegates to list', async () => {
    const user: AuthenticatedUser = { telegram_id: '42', username: 'bob' };
    service.list.mockResolvedValue([{ id: 'd-1' }]);
    const result = await controller.list(user);
    expect(service.list).toHaveBeenCalledWith(user);
    expect(result).toEqual([{ id: 'd-1' }]);
  });

  it('GET /deploys/:id delegates to getById', async () => {
    const user: AuthenticatedUser = { telegram_id: '42', username: 'bob' };
    service.getById.mockResolvedValue({ id: 'd-1' });
    const result = await controller.getById(user, 'd-1');
    expect(service.getById).toHaveBeenCalledWith(user, 'd-1');
    expect(result).toEqual({ id: 'd-1' });
  });
});
