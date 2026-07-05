import type { Request } from 'express';
import { BootstrapController } from './bootstrap.controller';
import { BootstrapService } from './bootstrap.service';

describe('BootstrapController', () => {
  let controller: BootstrapController;
  let service: { pull: jest.Mock };

  beforeEach(() => {
    service = { pull: jest.fn().mockResolvedValue({ env: '', config_yaml: '', compose: '', webhook_secret: 's' }) };
    controller = new BootstrapController(service as unknown as BootstrapService);
  });

  it('resolves the caller IP and forwards deployId + token to the service', async () => {
    const req = {
      headers: { 'x-forwarded-for': 'spoofed, 203.0.113.7' },
      socket: { remoteAddress: '172.18.0.2' },
    } as unknown as Request;

    await controller.pull('deploy-1', 'tok', req);

    expect(service.pull).toHaveBeenCalledWith('deploy-1', 'tok', '203.0.113.7');
  });

  it('passes an empty token when the query param is missing', async () => {
    const req = { headers: {}, socket: { remoteAddress: '1.2.3.4' } } as unknown as Request;
    await controller.pull('deploy-1', undefined, req);
    expect(service.pull).toHaveBeenCalledWith('deploy-1', '', '1.2.3.4');
  });
});
