import { ValidateBotTokenController } from './validate-bot-token.controller';
import { ValidateBotTokenService } from './validate-bot-token.service';

describe('ValidateBotTokenController', () => {
  let controller: ValidateBotTokenController;
  let service: { validate: jest.Mock };

  beforeEach(() => {
    service = { validate: jest.fn() };
    controller = new ValidateBotTokenController(service as unknown as ValidateBotTokenService);
  });

  it('POST /validate-bot-token delegates the bot_token to the service', async () => {
    service.validate.mockResolvedValue({ username: 'mybot', id: 42 });

    const result = await controller.validate({ bot_token: '123:abc' });

    expect(service.validate).toHaveBeenCalledWith('123:abc');
    expect(result).toEqual({ username: 'mybot', id: 42 });
  });
});
