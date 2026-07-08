import { ValidateLlmKeyController } from './validate-llm-key.controller';
import { ValidateLlmKeyService } from './validate-llm-key.service';

describe('ValidateLlmKeyController', () => {
  let controller: ValidateLlmKeyController;
  let service: { validate: jest.Mock };

  beforeEach(() => {
    service = { validate: jest.fn() };
    controller = new ValidateLlmKeyController(service as unknown as ValidateLlmKeyService);
  });

  it('POST /validate-llm-key delegates the dto to the service', async () => {
    service.validate.mockResolvedValue({
      ok: true,
      model: 'openai/gpt-4o-mini',
      supports_tools: true,
      supports_streaming: true,
    });

    const dto = { provider_id: 'openrouter', api_key: 'sk-x' };
    const result = await controller.validate(dto);

    expect(service.validate).toHaveBeenCalledWith(dto);
    expect(result).toEqual({
      ok: true,
      model: 'openai/gpt-4o-mini',
      supports_tools: true,
      supports_streaming: true,
    });
  });
});
