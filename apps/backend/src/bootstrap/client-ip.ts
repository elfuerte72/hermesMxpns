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
 * Resolve the caller's IP for the bootstrap IP check. Uses the LAST hop of
 * X-Forwarded-For — the entry appended by our own reverse proxy (Traefik/nginx
 * append the peer address, so earlier entries are client-controlled and
 * spoofable). Assumes exactly one trusted proxy in front of the backend; with
 * no proxy the header is absent and the socket address is used.
 */
export function resolveClientIp(req: IncomingLike): string | null {
  const xff = req.headers['x-forwarded-for'];
  const headerValue = Array.isArray(xff) ? xff[xff.length - 1] : xff;
  if (headerValue) {
    const hops = headerValue.split(',');
    const last = hops[hops.length - 1]?.trim();
    if (last) return normalizeIp(last);
  }
  const remote = req.socket?.remoteAddress ?? req.ip;
  return remote ? normalizeIp(remote) : null;
}
