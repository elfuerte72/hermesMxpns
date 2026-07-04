import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let service: { deployReady: jest.Mock };

  beforeEach(() => {
    service = { deployReady: jest.fn().mockResolvedValue({ status: 'ready' }) };
    controller = new WebhooksController(service as unknown as WebhooksService);
  });

  it('parses the Bearer secret and forwards deploy_id to the service', async () => {
    const result = await controller.deployReady({ deploy_id: 'deploy-1' }, 'Bearer s3cret');
    expect(service.deployReady).toHaveBeenCalledWith('deploy-1', 's3cret');
    expect(result).toEqual({ status: 'ready' });
  });

  it('passes an empty secret when the Authorization header is absent', async () => {
    await controller.deployReady({ deploy_id: 'deploy-1' }, undefined);
    expect(service.deployReady).toHaveBeenCalledWith('deploy-1', '');
  });
});
