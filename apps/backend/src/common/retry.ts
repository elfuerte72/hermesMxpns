export interface RetryOptions {
  /** Max retries after the first attempt. */
  retries: number;
  /** Base backoff; grows exponentially per attempt. */
  baseDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  isRetryable?: (err: unknown) => boolean;
}

/** Pull an HTTP status off an axios-style / status-bearing error. */
export function errorStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const response = (err as { response?: { status?: number } }).response;
    if (response && typeof response.status === 'number') return response.status;
    const status = (err as { status?: number }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

/** Retry transient failures only: 429, any 5xx, or a statusless (network) error. */
export function isTransient(err: unknown): boolean {
  const status = errorStatus(err);
  if (status === undefined) return true; // network / unknown
  if (status === 429) return true;
  return status >= 500;
}

/** Run `fn`, retrying transient failures with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const isRetryable = opts.isRetryable ?? isTransient;

  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === opts.retries || !isRetryable(err)) throw err;
      await sleep(opts.baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}
