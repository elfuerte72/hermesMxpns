import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { buildInitData } from './tma-validation';

const BOT_TOKEN = '123456789:AASeCRET-TOKEN-for-tests-only';
const USER_JSON = JSON.stringify({ id: 123456789, first_name: 'Alice', username: 'alice' });

function makeInitData(authDate: number): string {
  return buildInitData(BOT_TOKEN, { user: USER_JSON, auth_date: String(authDate), query_id: 'q' });
}

describe('AuthService', () => {
  let prisma: { user: { upsert: jest.Mock } };
  let service: AuthService;
  const nowMs = 1700000000_000;
  const authDateSec = 1700000000;

  beforeEach(() => {
    prisma = { user: { upsert: jest.fn().mockResolvedValue({}) } };
    service = new AuthService(prisma as never, BOT_TOKEN, 60);
  });

  it('authenticate returns the user for a valid initData', () => {
    const user = service.authenticate(makeInitData(authDateSec), nowMs);
    expect(user).toEqual({ telegram_id: '123456789', username: 'alice' });
  });

  it('authenticate throws UnauthorizedException on an invalid signature', () => {
    const initData = makeInitData(authDateSec).replace(/hash=[0-9a-f]+$/, 'hash=' + '0'.repeat(64));
    expect(() => service.authenticate(initData, nowMs)).toThrow(UnauthorizedException);
  });

  it('authenticate throws on expired initData', () => {
    const stale = makeInitData(authDateSec - 120);
    expect(() => service.authenticate(stale, nowMs)).toThrow(UnauthorizedException);
  });

  it('validateInitAndUpsert upserts the user by telegram_id (BigInt) and returns it', async () => {
    const user = await service.validateInitAndUpsert(makeInitData(authDateSec), nowMs);

    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { telegram_id: 123456789n },
      create: { telegram_id: 123456789n, username: 'alice' },
      update: { username: 'alice' },
    });
    expect(user).toEqual({ telegram_id: '123456789', username: 'alice' });
  });

  it('validateInitAndUpsert does not call prisma when the signature is invalid', async () => {
    const bad = makeInitData(authDateSec).replace(/hash=[0-9a-f]+$/, 'hash=bad');
    await expect(service.validateInitAndUpsert(bad, nowMs)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('upserts with a null username when the user has none', async () => {
    const userJson = JSON.stringify({ id: 55, first_name: 'Bob' });
    const initData = buildInitData(BOT_TOKEN, {
      user: userJson,
      auth_date: String(authDateSec),
      query_id: 'q',
    });

    await service.validateInitAndUpsert(initData, nowMs);

    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { telegram_id: 55n },
      create: { telegram_id: 55n, username: null },
      update: { username: null },
    });
  });
});
