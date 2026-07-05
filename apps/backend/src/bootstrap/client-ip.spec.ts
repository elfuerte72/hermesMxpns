import { normalizeIp, resolveClientIp, type IncomingLike } from './client-ip';

describe('normalizeIp', () => {
  it('strips the IPv4-mapped IPv6 prefix', () => {
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeIp('  1.2.3.4 ')).toBe('1.2.3.4');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
  });
});

describe('resolveClientIp', () => {
  it('uses the last hop of X-Forwarded-For (appended by the trusted proxy)', () => {
    const req: IncomingLike = {
      headers: { 'x-forwarded-for': '1.2.3.4' },
      socket: { remoteAddress: '172.18.0.2' },
    };
    expect(resolveClientIp(req)).toBe('1.2.3.4');
  });

  it('ignores client-supplied entries prepended before the trusted hop', () => {
    const req: IncomingLike = {
      headers: { 'x-forwarded-for': 'spoofed-vm-ip, 1.2.3.4' },
      socket: { remoteAddress: '172.18.0.2' },
    };
    expect(resolveClientIp(req)).toBe('1.2.3.4');
  });

  it('uses the last header value when the header is repeated', () => {
    const req: IncomingLike = {
      headers: { 'x-forwarded-for': ['spoofed-vm-ip', '1.2.3.4'] },
      socket: { remoteAddress: '172.18.0.2' },
    };
    expect(resolveClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to the socket address when no header is present', () => {
    const req: IncomingLike = { headers: {}, socket: { remoteAddress: '::ffff:5.6.7.8' } };
    expect(resolveClientIp(req)).toBe('5.6.7.8');
  });

  it('returns null when nothing is available', () => {
    expect(resolveClientIp({ headers: {} })).toBeNull();
  });
});
