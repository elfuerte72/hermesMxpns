import {
  buildDataCheckString,
  buildInitData,
  computeInitDataHash,
  parseInitData,
  TmaValidationError,
  validateInitData,
} from './tma-validation';

const BOT_TOKEN = '123456789:AASeCRET-TOKEN-for-tests-only';
const OTHER_TOKEN = '999999999:BBdifferent-token';

const USER_JSON = JSON.stringify({
  id: 123456789,
  first_name: 'Alice',
  last_name: 'Smith',
  username: 'alice',
  language_code: 'en',
});

function makeParams(authDate: number, userJson: string = USER_JSON): Record<string, string> {
  return {
    query_id: 'AAHdqTcvAAAA1I6mFw2bWw',
    user: userJson,
    auth_date: String(authDate),
  };
}

describe('tma-validation', () => {
  describe('parseInitData', () => {
    it('extracts hash, auth_date, params and the user object', () => {
      const initData = buildInitData(BOT_TOKEN, makeParams(1700000000));
      const parsed = parseInitData(initData);

      expect(parsed.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(parsed.authDate).toBe(1700000000);
      expect(parsed.params.get('query_id')).toBe('AAHdqTcvAAAA1I6mFw2bWw');
      expect(parsed.user?.id).toBe(123456789);
      expect(parsed.user?.username).toBe('alice');
    });

    it('throws missing_hash when hash is absent', () => {
      expect(() => parseInitData('auth_date=1700000000&user=x')).toThrow(TmaValidationError);
      expect(() => parseInitData('auth_date=1700000000&user=x')).toThrow(/hash/);
    });

    it('throws missing_auth_date when auth_date is absent', () => {
      const initData = buildInitData(BOT_TOKEN, { user: USER_JSON }) + '&hash=bogus';
      expect(() => parseInitData(initData.replace(/&hash=[^&]+/, '&hash=abc'))).toThrow(
        TmaValidationError,
      );
    });

    it('throws malformed on empty input', () => {
      expect(() => parseInitData('')).toThrow(TmaValidationError);
    });
  });

  describe('buildDataCheckString', () => {
    it('sorts keys alphabetically and joins with newlines', () => {
      const params = new Map([
        ['user', '{"id":1}'],
        ['auth_date', '123'],
        ['query_id', 'q'],
      ]);
      expect(buildDataCheckString(params)).toBe(
        'auth_date=123\nquery_id=q\nuser={"id":1}',
      );
    });
  });

  describe('computeInitDataHash', () => {
    it('produces a stable 64-char hex digest', () => {
      const digest = computeInitDataHash(BOT_TOKEN, 'auth_date=1\nquery_id=q');
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(computeInitDataHash(BOT_TOKEN, 'auth_date=1\nquery_id=q')).toBe(digest);
    });

    it('differs for a different bot token', () => {
      expect(computeInitDataHash(BOT_TOKEN, 'x')).not.toBe(computeInitDataHash(OTHER_TOKEN, 'x'));
    });
  });

  describe('validateInitData', () => {
    const nowMs = 1700000000_000;
    const authDateSec = 1700000000;

    it('returns the telegram id and username for a valid signature', () => {
      const initData = buildInitData(BOT_TOKEN, makeParams(authDateSec));
      const result = validateInitData(initData, { botToken: BOT_TOKEN, now: nowMs, maxAgeSeconds: 60 });
      expect(result).toEqual({
        telegramId: '123456789',
        username: 'alice',
        authDate: authDateSec,
      });
    });

    it('rejects a tampered hash (invalid signature)', () => {
      const initData = buildInitData(BOT_TOKEN, makeParams(authDateSec)).replace(
        /hash=[0-9a-f]+$/,
        'hash=' + '0'.repeat(64),
      );
      expect(() =>
        validateInitData(initData, { botToken: BOT_TOKEN, now: nowMs, maxAgeSeconds: 60 }),
      ).toThrow(TmaValidationError);
      try {
        validateInitData(initData, { botToken: BOT_TOKEN, now: nowMs, maxAgeSeconds: 60 });
      } catch (err) {
        expect((err as TmaValidationError).code).toBe('invalid_signature');
      }
    });

    it('rejects data signed with a different bot token', () => {
      const initData = buildInitData(OTHER_TOKEN, makeParams(authDateSec));
      try {
        validateInitData(initData, { botToken: BOT_TOKEN, now: nowMs, maxAgeSeconds: 60 });
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TmaValidationError);
        expect((err as TmaValidationError).code).toBe('invalid_signature');
      }
    });

    it('rejects an expired auth_date', () => {
      const staleAuthDate = authDateSec - 120;
      const initData = buildInitData(BOT_TOKEN, makeParams(staleAuthDate));
      expect(() =>
        validateInitData(initData, { botToken: BOT_TOKEN, now: nowMs, maxAgeSeconds: 60 }),
      ).toThrow(TmaValidationError);
      try {
        validateInitData(initData, { botToken: BOT_TOKEN, now: nowMs, maxAgeSeconds: 60 });
      } catch (err) {
        expect((err as TmaValidationError).code).toBe('expired');
      }
    });

    it('accepts expired data when maxAgeSeconds is undefined (signature only)', () => {
      const staleAuthDate = authDateSec - 999999;
      const initData = buildInitData(BOT_TOKEN, makeParams(staleAuthDate));
      const result = validateInitData(initData, { botToken: BOT_TOKEN });
      expect(result.telegramId).toBe('123456789');
    });

    it('throws malformed when BOT_TOKEN is empty', () => {
      const initData = buildInitData(BOT_TOKEN, makeParams(authDateSec));
      expect(() => validateInitData(initData, { botToken: '', now: nowMs })).toThrow(
        /BOT_TOKEN/,
      );
    });

    it('throws when the user object is missing', () => {
      const initData = buildInitData(BOT_TOKEN, { auth_date: String(authDateSec), query_id: 'q' });
      expect(() =>
        validateInitData(initData, { botToken: BOT_TOKEN, now: nowMs, maxAgeSeconds: 60 }),
      ).toThrow(/user/);
    });
  });
});
