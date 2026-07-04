export interface IncomingLike {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | null };
  ip?: string;
}

/** Strip an IPv4-mapped IPv6 prefix so ::ffff:1.2.3.4 compares equal to 1.2.3.4. */
export function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  return trimmed.startsWith('::ffff:') ? trimmed.slice('::ffff:'.length) : trimmed;
}

/**
 * Resolve the caller's IP for the bootstrap IP check. Prefers the first hop of
 * X-Forwarded-For (backend sits behind HTTPS termination), else the socket
 * address. Returns null when nothing is available.
 */
export function resolveClientIp(req: IncomingLike): string | null {
  const xff = req.headers['x-forwarded-for'];
  const headerValue = Array.isArray(xff) ? xff[0] : xff;
  if (headerValue) {
    const first = headerValue.split(',')[0]?.trim();
    if (first) return normalizeIp(first);
  }
  const remote = req.socket?.remoteAddress ?? req.ip;
  return remote ? normalizeIp(remote) : null;
}
