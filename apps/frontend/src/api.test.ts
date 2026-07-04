import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createDeploy, fetchProviders, getDeploy, validateBotToken } from './api';

function mockFetch(response: { ok: boolean; status: number; body: unknown }) {
  const fn = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    statusText: 'STATUS',
    json: async () => response.body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('api client', () => {
  beforeEach(() => {
    window.Telegram = { WebApp: { initData: 'INIT', ready: () => {}, expand: () => {} } };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.Telegram;
  });

  it('fetchProviders GETs /llm-providers without auth', async () => {
    const fetchFn = mockFetch({ ok: true, status: 200, body: [{ id: 'groq' }] });
    const providers = await fetchProviders();

    expect(providers).toEqual([{ id: 'groq' }]);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/llm-providers');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('validateBotToken POSTs with the tma auth header and body', async () => {
    const fetchFn = mockFetch({ ok: true, status: 200, body: { username: 'b', id: 1 } });
    await validateBotToken('123:abc');

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/validate-bot-token');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('tma INIT');
    expect(JSON.parse(init.body)).toEqual({ bot_token: '123:abc' });
  });

  it('createDeploy POSTs /deploys with auth', async () => {
    const fetchFn = mockFetch({ ok: true, status: 202, body: { deploy_id: 'd1', status: 'pending' } });
    const res = await createDeploy({ bot_token: '1:a', llm_provider: 'groq', llm_key: 'k' });

    expect(res).toEqual({ deploy_id: 'd1', status: 'pending' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/deploys');
    expect(init.headers.Authorization).toBe('tma INIT');
  });

  it('getDeploy GETs /deploys/:id', async () => {
    const fetchFn = mockFetch({ ok: true, status: 200, body: { id: 'd1', status: 'ready' } });
    const view = await getDeploy('d1');

    expect(view).toMatchObject({ id: 'd1', status: 'ready' });
    expect(fetchFn.mock.calls[0][0]).toBe('/deploys/d1');
  });

  it('throws ApiError carrying the status and server message', async () => {
    mockFetch({ ok: false, status: 422, body: { message: 'Invalid Telegram bot token' } });
    await expect(validateBotToken('bad')).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      message: 'Invalid Telegram bot token',
    });
  });

  it('joins array validation messages', async () => {
    mockFetch({ ok: false, status: 400, body: { message: ['a required', 'b required'] } });
    await expect(fetchProviders()).rejects.toBeInstanceOf(ApiError);
    await expect(fetchProviders()).rejects.toHaveProperty('message', 'a required, b required');
  });
});
