import {
  bootstrapTokenMatches,
  generateBootstrapToken,
  hashBootstrapToken,
} from './bootstrap-token';

describe('bootstrap-token', () => {
  it('generates a token and its sha-256 hash', () => {
    const { token, hash } = generateBootstrapToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hex
    expect(hash).toBe(hashBootstrapToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
  });

  it('produces a distinct token on each call', () => {
    const a = generateBootstrapToken();
    const b = generateBootstrapToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });

  it('matches a token against its stored hash', () => {
    const { token, hash } = generateBootstrapToken();
    expect(bootstrapTokenMatches(token, hash)).toBe(true);
  });

  it('rejects a wrong token', () => {
    const { hash } = generateBootstrapToken();
    expect(bootstrapTokenMatches('deadbeef', hash)).toBe(false);
  });

  it('rejects a malformed stored hash without throwing', () => {
    const { token } = generateBootstrapToken();
    expect(bootstrapTokenMatches(token, 'not-hex')).toBe(false);
  });
});
