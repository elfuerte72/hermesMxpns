import { SecretsService } from '../secrets/secrets.service';
import { TokenHealthcheckService } from './token-healthcheck.service';

const TEST_KEY = 'a'.repeat(64);

describe('TokenHealthcheckService', () => {
  let prisma: { deploy: { findMany: jest.Mock; update: jest.Mock } };
  let secrets: SecretsService;
  let validateBotToken: { isTokenValid: jest.Mock };
  let service: TokenHealthcheckService;

  beforeEach(() => {
    secrets = new SecretsService(TEST_KEY);
    prisma = {
      deploy: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    validateBotToken = { isTokenValid: jest.fn().mockResolvedValue(true) };
    service = new TokenHealthcheckService(
      prisma as never,
      secrets,
      validateBotToken as never,
      { dryRun: false },
    );
  });

  it('skips under DRY_RUN and makes no Telegram calls', async () => {
    service = new TokenHealthcheckService(prisma as never, secrets, validateBotToken as never, {
      dryRun: true,
    });

    const result = await service.checkOnce();

    expect(result).toEqual({ checked: 0, invalidated: 0 });
    expect(prisma.deploy.findMany).not.toHaveBeenCalled();
    expect(validateBotToken.isTokenValid).not.toHaveBeenCalled();
  });

  it('marks each ready deploy valid/invalid based on getMe', async () => {
    prisma.deploy.findMany.mockResolvedValue([
      { id: 'd-1', bot_token_enc: secrets.encrypt('111:good') },
      { id: 'd-2', bot_token_enc: secrets.encrypt('222:bad') },
    ]);
    validateBotToken.isTokenValid
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const result = await service.checkOnce();

    expect(result).toEqual({ checked: 2, invalidated: 1 });
    expect(validateBotToken.isTokenValid).toHaveBeenCalledTimes(2);
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: { bot_token_status: 'valid' },
    });
    expect(prisma.deploy.update).toHaveBeenCalledWith({
      where: { id: 'd-2' },
      data: { bot_token_status: 'invalid' },
    });
  });

  it('only queries ready deploys', async () => {
    await service.checkOnce();
    expect(prisma.deploy.findMany).toHaveBeenCalledWith({
      where: { status: 'ready' },
      select: { id: true, bot_token_enc: true },
    });
  });

  it('returns zero counts when there are no ready deploys', async () => {
    prisma.deploy.findMany.mockResolvedValue([]);
    const result = await service.checkOnce();
    expect(result).toEqual({ checked: 0, invalidated: 0 });
  });
});
