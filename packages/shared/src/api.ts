export const TMA_AUTH_HEADER = 'authorization';
export const TMA_AUTH_SCHEME = 'tma';

export function buildTmaAuthHeader(initData: string): string {
  return `${TMA_AUTH_SCHEME} ${initData}`;
}

export function parseTmaAuthHeader(header: string | undefined): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  const prefix = `${TMA_AUTH_SCHEME} `;
  if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  return trimmed.slice(prefix.length).trim() || null;
}
