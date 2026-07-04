import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { buildInitData } from './tma-validation';
import { TmaAuthGuard, TMA_USER_KEY, type RequestWithTmaUser } from './tma-auth.guard';
import { AuthService } from './auth.service';

const BOT_TOKEN = '123456789:AASeCRET-TOKEN-for-tests-only';
const USER_JSON = JSON.stringify({ id: 123456789, first_name: 'Alice', username: 'alice' });

function makeContext(headers: Record<string, string>): ExecutionContext {
  const request = { headers } as unknown as RequestWithTmaUser;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('TmaAuthGuard', () => {
  let authService: { authenticate: jest.Mock };
  let guard: TmaAuthGuard;

  beforeEach(() => {
    authService = { authenticate: jest.fn() };
    guard = new TmaAuthGuard(authService as unknown as AuthService);
  });

  it('authenticates and attaches the user when a valid tma header is present', () => {
    const initData = buildInitData(BOT_TOKEN, { user: USER_JSON, auth_date: '1', query_id: 'q' });
    authService.authenticate.mockReturnValue({ telegram_id: '123', username: 'alice' });

    const ctx = makeContext({ authorization: `tma ${initData}` });
    expect(guard.canActivate(ctx)).toBe(true);

    const request = ctx.switchToHttp().getRequest<RequestWithTmaUser>();
    expect(request[TMA_USER_KEY]).toEqual({ telegram_id: '123', username: 'alice' });
    expect(authService.authenticate).toHaveBeenCalledWith(initData);
  });

  it('rejects when the authorization header is missing', () => {
    expect(() => guard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
    expect(authService.authenticate).not.toHaveBeenCalled();
  });

  it('rejects when the header uses a different scheme', () => {
    expect(() => guard.canActivate(makeContext({ authorization: 'Bearer abc' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rethrows UnauthorizedException from the service', () => {
    const initData = buildInitData(BOT_TOKEN, { user: USER_JSON, auth_date: '1', query_id: 'q' });
    authService.authenticate.mockImplementation(() => {
      throw new UnauthorizedException('bad signature');
    });

    expect(() => guard.canActivate(makeContext({ authorization: `tma ${initData}` }))).toThrow(
      UnauthorizedException,
    );
  });
});
