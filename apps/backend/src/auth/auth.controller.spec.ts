import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { validateInitAndUpsert: jest.Mock };

  beforeEach(async () => {
    authService = { validateInitAndUpsert: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();
    controller = moduleRef.get(AuthController);
  });

  it('validateInit delegates to the service and returns { user }', async () => {
    authService.validateInitAndUpsert.mockResolvedValue({
      telegram_id: '123',
      username: 'alice',
    });

    const result = await controller.validateInit({ initData: 'valid-init-data' });

    expect(authService.validateInitAndUpsert).toHaveBeenCalledWith('valid-init-data');
    expect(result).toEqual({ user: { telegram_id: '123', username: 'alice' } });
  });
});
