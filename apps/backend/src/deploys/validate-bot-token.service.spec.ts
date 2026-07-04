jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));

import axios from 'axios';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { ValidateBotTokenService } from './validate-bot-token.service';

const TOKEN = '123456789:AAH-test-token';
const TELEGRAM_BASE = 'https://api.telegram.org';

function mockGetMe(payload: unknown): void {
  (axios.get as unknown as jest.Mock).mockResolvedValue({ data: payload });
}

function mockGetMeRejects(err: unknown): void {
  (axios.get as unknown as jest.Mock).mockRejectedValue(err);
}

describe('ValidateBotTokenService', () => {
  let prisma: { deploy: { findFirst: jest.Mock } };
  let service: ValidateBotTokenService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = { deploy: { findFirst: jest.fn().mockResolvedValue(null) } };
    service = new ValidateBotTokenService(prisma as never, TELEGRAM_BASE);
  });

  it('returns username + id for a valid bot token not in use', async () => {
    mockGetMe({ ok: true, result: { id: 42, username: 'myhermesbot', first_name: 'Bot', is_bot: true } });

    const result = await service.validate(TOKEN);

    expect(axios.get).toHaveBeenCalledWith(`${TELEGRAM_BASE}/bot${TOKEN}/getMe`);
    expect(result).toEqual({ username: 'myhermesbot', id: 42 });
    expect(prisma.deploy.findFirst).toHaveBeenCalledWith({
      where: { bot_username: 'myhermesbot', status: { in: ['pending', 'creating', 'configuring', 'ready'] } },
      select: { id: true },
    });
  });

  it('throws 422 when Telegram reports ok: false', async () => {
    mockGetMe({ ok: false, description: 'Unauthorized' });

    await expect(service.validate(TOKEN)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.deploy.findFirst).not.toHaveBeenCalled();
  });

  it('throws 422 when the request rejects (invalid token / network)', async () => {
    mockGetMeRejects(new Error('401'));

    await expect(service.validate(TOKEN)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 422 when the token does not belong to a bot', async () => {
    mockGetMe({ ok: true, result: { id: 1, username: 'notabot', first_name: 'X', is_bot: false } });

    await expect(service.validate(TOKEN)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 409 when an active deploy already uses this bot username', async () => {
    mockGetMe({ ok: true, result: { id: 42, username: 'takenbot', first_name: 'Bot', is_bot: true } });
    prisma.deploy.findFirst.mockResolvedValue({ id: 'existing-deploy-id' });

    await expect(service.validate(TOKEN)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not block when only a failed/deleted deploy exists', async () => {
    mockGetMe({ ok: true, result: { id: 42, username: 'reusebot', first_name: 'Bot', is_bot: true } });
    prisma.deploy.findFirst.mockResolvedValue(null);

    const result = await service.validate(TOKEN);
    expect(result).toEqual({ username: 'reusebot', id: 42 });
  });

  it('strips nothing from the token when building the getMe URL', async () => {
    mockGetMe({ ok: true, result: { id: 1, username: 'b', first_name: 'B', is_bot: true } });
    await service.validate('999:Z-Y_x');
    expect(axios.get).toHaveBeenCalledWith(`${TELEGRAM_BASE}/bot999:Z-Y_x/getMe`);
  });
});
