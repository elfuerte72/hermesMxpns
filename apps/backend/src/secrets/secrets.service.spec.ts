import { SecretsService } from './secrets.service';

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const OTHER_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

describe('SecretsService', () => {
  let svc: SecretsService;

  beforeEach(() => {
    svc = new SecretsService(KEY);
  });

  it('round-trips encrypt -> decrypt', () => {
    const plaintext = 'super-secret-bot-token:1234:abcdef';
    const encrypted = svc.encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(svc.decrypt(encrypted)).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const plaintext = 'same-value';
    const a = svc.encrypt(plaintext);
    const b = svc.encrypt(plaintext);
    expect(a).not.toBe(b);
    expect(svc.decrypt(a)).toBe(plaintext);
    expect(svc.decrypt(b)).toBe(plaintext);
  });

  it('detects tampering via the GCM auth tag', () => {
    const encrypted = svc.encrypt('secret');
    const buf = Buffer.from(encrypted.slice(3), 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tampered = 'v1:' + buf.toString('base64');
    expect(() => svc.decrypt(tampered)).toThrow();
  });

  it('fails to decrypt with a different key', () => {
    const encrypted = svc.encrypt('secret');
    const other = new SecretsService(OTHER_KEY);
    expect(() => other.decrypt(encrypted)).toThrow();
  });

  it('throws on an unsupported format', () => {
    expect(() => svc.decrypt('not-a-valid-payload')).toThrow();
  });

  it('throws on a too-short ciphertext', () => {
    expect(() => svc.decrypt('v1:' + Buffer.from('short').toString('base64'))).toThrow();
  });

  it('rejects an invalid key length', () => {
    expect(() => new SecretsService('too-short')).toThrow();
  });
});
