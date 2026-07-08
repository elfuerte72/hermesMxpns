import { LlmProvidersController } from './llm-providers.controller';
import { LlmProvidersService } from './llm-providers.service';

describe('LlmProvidersController', () => {
  let service: { list: jest.Mock };
  let controller: LlmProvidersController;

  beforeEach(() => {
    service = { list: jest.fn().mockReturnValue([{ id: 'openrouter' }]) };
    controller = new LlmProvidersController(service as unknown as LlmProvidersService);
  });

  it('GET /llm-providers lists only openrouter by default', () => {
    const result = controller.list();
    expect(service.list).toHaveBeenCalledWith(false);
    expect(result).toEqual([{ id: 'openrouter' }]);
  });

  it('GET /llm-providers?advanced=1 reveals the BYOK custom provider too', () => {
    service.list.mockReturnValue([{ id: 'openrouter' }, { id: 'custom' }]);

    const result = controller.list('1');

    expect(service.list).toHaveBeenCalledWith(true);
    expect(result).toEqual([{ id: 'openrouter' }, { id: 'custom' }]);
  });
});
