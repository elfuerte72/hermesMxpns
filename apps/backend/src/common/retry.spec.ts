import { errorStatus, isTransient, withRetry } from './retry';

const NOOP_SLEEP = () => Promise.resolve();

describe('errorStatus / isTransient', () => {
  it('reads axios response.status and top-level status', () => {
    expect(errorStatus({ response: { status: 503 } })).toBe(503);
    expect(errorStatus({ status: 429 })).toBe(429);
    expect(errorStatus(new Error('x'))).toBeUndefined();
  });

  it('treats 429, 5xx and network errors as transient; 4xx as fatal', () => {
    expect(isTransient({ response: { status: 429 } })).toBe(true);
    expect(isTransient({ response: { status: 500 } })).toBe(true);
    expect(isTransient({ response: { status: 502 } })).toBe(true);
    expect(isTransient(new Error('network'))).toBe(true);
    expect(isTransient({ response: { status: 400 } })).toBe(false);
    expect(isTransient({ response: { status: 404 } })).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns on the first success without sleeping', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const sleep = jest.fn().mockResolvedValue(undefined);
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 10, sleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries transient failures then succeeds, backing off exponentially', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockResolvedValue('ok');
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(withRetry(fn, { retries: 3, baseDelayMs: 10, sleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it('does not retry a fatal 4xx error', async () => {
    const fn = jest.fn().mockRejectedValue({ response: { status: 400 } });
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1, sleep: NOOP_SLEEP })).rejects.toEqual({
      response: { status: 400 },
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting retries and throws the last error', async () => {
    const fn = jest.fn().mockRejectedValue({ response: { status: 500 } });
    await expect(
      withRetry(fn, { retries: 2, baseDelayMs: 1, sleep: NOOP_SLEEP }),
    ).rejects.toEqual({ response: { status: 500 } });
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });
});
