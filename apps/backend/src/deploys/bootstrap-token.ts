import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Bytes of entropy in the one-time bootstrap token. */
const TOKEN_BYTES = 32;

export interface BootstrapToken {
  /** Plaintext token — travels to the VPS via the deploy job, never stored. */
  token: string;
  /** SHA-256 hex of the token — the only form persisted in the DB. */
  hash: string;
}

/** Generate a fresh one-time bootstrap token and its stored hash. */
export function generateBootstrapToken(): BootstrapToken {
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  return { token, hash: hashBootstrapToken(token) };
}

/** Deterministic hash of a bootstrap token (what we compare against in the DB). */
export function hashBootstrapToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison of a presented token against a stored hash. */
export function bootstrapTokenMatches(token: string, storedHash: string): boolean {
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashBootstrapToken(token), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
