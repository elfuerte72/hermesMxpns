import { createHmac } from 'node:crypto';
import type { TmaUser } from '@hermes/shared';

const WEB_APP_DATA_KEY = 'WebAppData';

export interface ParsedInitData {
  params: Map<string, string>;
  hash: string;
  authDate: number;
  user: TmaUser | null;
}

export class TmaValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'malformed' | 'missing_hash' | 'missing_auth_date' | 'invalid_signature' | 'expired',
  ) {
    super(message);
    this.name = 'TmaValidationError';
  }
}

export function parseInitData(initData: string): ParsedInitData {
  if (!initData || typeof initData !== 'string') {
    throw new TmaValidationError('initData is empty', 'malformed');
  }

  const search = new URLSearchParams(initData);
  const hash = search.get('hash');
  if (!hash) {
    throw new TmaValidationError('initData is missing the hash field', 'missing_hash');
  }

  const authDateRaw = search.get('auth_date');
  if (authDateRaw === null) {
    throw new TmaValidationError('initData is missing the auth_date field', 'missing_auth_date');
  }
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new TmaValidationError('auth_date is not a valid unix timestamp', 'malformed');
  }

  const params = new Map<string, string>();
  for (const [key, value] of search.entries()) {
    if (key !== 'hash') params.set(key, value);
  }

  const userRaw = search.get('user');
  const user = userRaw ? (JSON.parse(userRaw) as TmaUser) : null;

  return { params, hash, authDate, user };
}

export function buildDataCheckString(params: Map<string, string>): string {
  return [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function computeInitDataHash(botToken: string, dataCheckString: string): string {
  const secretKey = createHmac('sha256', WEB_APP_DATA_KEY).update(botToken).digest();
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

export interface ValidateInitDataOptions {
  botToken: string;
  now?: number;
  maxAgeSeconds?: number;
}

export interface ValidatedTmaUser {
  telegramId: string;
  username: string | null;
  authDate: number;
}

export function validateInitData(
  initData: string,
  { botToken, now = Date.now(), maxAgeSeconds }: ValidateInitDataOptions,
): ValidatedTmaUser {
  if (!botToken) {
    throw new TmaValidationError('BOT_TOKEN is not configured', 'malformed');
  }

  const parsed = parseInitData(initData);
  const dataCheckString = buildDataCheckString(parsed.params);
  const computedHash = computeInitDataHash(botToken, dataCheckString);

  if (computedHash !== parsed.hash) {
    throw new TmaValidationError('Telegram initData signature is invalid', 'invalid_signature');
  }

  if (maxAgeSeconds !== undefined) {
    const ageSeconds = Math.floor(now / 1000) - parsed.authDate;
    if (ageSeconds > maxAgeSeconds) {
      throw new TmaValidationError('Telegram initData has expired', 'expired');
    }
  }

  if (!parsed.user || parsed.user.id === undefined) {
    throw new TmaValidationError('initData is missing the user object', 'malformed');
  }

  return {
    telegramId: String(parsed.user.id),
    username: parsed.user.username ?? null,
    authDate: parsed.authDate,
  };
}

export function buildInitData(botToken: string, params: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.set(key, value);
  }
  const dataCheckString = buildDataCheckString(new Map(Object.entries(params)));
  const hash = computeInitDataHash(botToken, dataCheckString);
  search.set('hash', hash);
  return search.toString();
}
