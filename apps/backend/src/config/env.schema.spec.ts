import { validateEnv } from './env.schema';

const valid = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/hermes_deployer',
  REDIS_URL: 'redis://localhost:6379',
  HOSTINGER_API_TOKEN: 'operator-token',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  BACKEND_URL: 'http://localhost:3000',
  MINI_APP_URL: 'http://localhost:5173',
  DRY_RUN: 'true',
};

describe('env schema', () => {
  it('parses a valid env and applies defaults/transforms', () => {
    const env = validateEnv(valid);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.HOSTINGER_API_TOKEN).toBe('operator-token');
    expect(env.DRY_RUN).toBe(true);
    expect(env.PORT).toBe(3000);
    expect(env.BOT_TOKEN).toBe('');
    expect(env.TMA_AUTH_MAX_AGE_SECONDS).toBe(86400);
    expect(env.SERVE_FRONTEND_DIR).toBeUndefined();
  });

  it('coerces TMA_AUTH_MAX_AGE_SECONDS to a number', () => {
    const env = validateEnv({ ...valid, TMA_AUTH_MAX_AGE_SECONDS: '3600' });
    expect(env.TMA_AUTH_MAX_AGE_SECONDS).toBe(3600);
  });

  it('throws when a required var is missing (HOSTINGER_API_TOKEN)', () => {
    const { HOSTINGER_API_TOKEN: _omit, ...rest } = valid;
    expect(() => validateEnv(rest)).toThrow();
  });

  it('throws on a malformed ENCRYPTION_KEY', () => {
    expect(() => validateEnv({ ...valid, ENCRYPTION_KEY: 'not-hex' })).toThrow();
  });

  it('throws on an invalid DATABASE_URL', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'not-a-url' })).toThrow();
  });

  it('coerces DRY_RUN=false to boolean false', () => {
    const env = validateEnv({ ...valid, DRY_RUN: 'false' });
    expect(env.DRY_RUN).toBe(false);
  });
});
