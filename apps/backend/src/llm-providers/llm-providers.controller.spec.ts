import { Test } from '@nestjs/testing';
import { LlmProvidersController } from './llm-providers.controller';
import { LlmProvidersService } from './llm-providers.service';

describe('LlmProvidersController', () => {
  let controller: LlmProvidersController;
  let service: { list: jest.Mock };

  beforeEach(async () => {
    service = { list: jest.fn().mockReturnValue([{ id: 'groq' }]) };
    const moduleRef = await Test.createTestingModule({
      controllers: [LlmProvidersController],
      providers: [{ provide: LlmProvidersService, useValue: service }],
    }).compile();
    controller = moduleRef.get(LlmProvidersController);
  });

  it('GET /llm-providers delegates to the service', () => {
    const result = controller.list();
    expect(service.list).toHaveBeenCalled();
    expect(result).toEqual([{ id: 'groq' }]);
  });
});
