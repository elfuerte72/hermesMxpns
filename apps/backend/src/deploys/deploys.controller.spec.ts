import type { AuthenticatedUser } from '@hermes/shared';
import { DeploysController } from './deploys.controller';
import { DeploysService } from './deploys.service';
import type { CreateDeployDto } from './create-deploy.dto';

describe('DeploysController', () => {
  let controller: DeploysController;
  let service: {
    create: jest.Mock;
    list: jest.Mock;
    getById: jest.Mock;
    requestTeardown: jest.Mock;
    restart: jest.Mock;
    updateLlmKey: jest.Mock;
  };

  beforeEach(() => {
    service = {
      create: jest.fn(),
      list: jest.fn(),
      getById: jest.fn(),
      requestTeardown: jest.fn(),
      restart: jest.fn(),
      updateLlmKey: jest.fn(),
    };
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

  it('DELETE /deploys/:id delegates to requestTeardown', async () => {
    const user: AuthenticatedUser = { telegram_id: '42', username: 'bob' };
    service.requestTeardown.mockResolvedValue({ id: 'd-1', status: 'ready' });
    const result = await controller.teardown(user, 'd-1');
    expect(service.requestTeardown).toHaveBeenCalledWith(user, 'd-1');
    expect(result).toEqual({ id: 'd-1', status: 'ready' });
  });

  it('POST /deploys/:id/restart delegates to restart', async () => {
    const user: AuthenticatedUser = { telegram_id: '42', username: 'bob' };
    service.restart.mockResolvedValue({ ok: true });
    const result = await controller.restart(user, 'd-1');
    expect(service.restart).toHaveBeenCalledWith(user, 'd-1');
    expect(result).toEqual({ ok: true });
  });

  it('PATCH /deploys/:id/llm-key delegates to updateLlmKey', async () => {
    const user: AuthenticatedUser = { telegram_id: '42', username: 'bob' };
    const dto = { provider_id: 'groq', api_key: 'sk-x' };
    service.updateLlmKey.mockResolvedValue({ ok: true });
    const result = await controller.updateLlmKey(user, 'd-1', dto);
    expect(service.updateLlmKey).toHaveBeenCalledWith(user, 'd-1', dto);
    expect(result).toEqual({ ok: true });
  });
});
