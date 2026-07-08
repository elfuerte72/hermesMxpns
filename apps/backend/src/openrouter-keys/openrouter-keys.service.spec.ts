jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn(), patch: jest.fn(), get: jest.fn(), delete: jest.fn() },
}));

import axios from 'axios';
import { BadGatewayException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { OPENROUTER_API_BASE } from '@hermes/shared';
import { OpenRouterKeysService } from './openrouter-keys.service';

const post = axios.post as unknown as jest.Mock;
const patch = axios.patch as unknown as jest.Mock;
const get = axios.get as unknown as jest.Mock;
const del = axios.delete as unknown as jest.Mock;

const MGMT_KEY = 'mgmt-secret';
const KEY_HASH = 'f01d52606dc8f0a8303a7b5cc3fa07109c2e346cec7c0a16b40de462992ce943';

describe('OpenRouterKeysService', () => {
  let service: OpenRouterKeysService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OpenRouterKeysService(MGMT_KEY, OPENROUTER_API_BASE);
  });

  function expectAuthHeader(config: unknown): void {
    const headers = (config as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe(`Bearer ${MGMT_KEY}`);
  }

  describe('createKey', () => {
    it('POSTs /keys with name/limit/limit_reset and returns the plaintext key + hash', async () => {
      post.mockResolvedValue({ data: { key: 'sk-or-v1-abc', hash: KEY_HASH } });

      const result = await service.createKey({ name: 'hermes-deploy-1', limit: 40 });

      expect(post).toHaveBeenCalledTimes(1);
      const [url, body, config] = post.mock.calls[0];
      expect(url).toBe(`${OPENROUTER_API_BASE}/keys`);
      expect(body).toEqual({ name: 'hermes-deploy-1', limit: 40, limit_reset: 'monthly' });
      expectAuthHeader(config);
      expect(result).toEqual({ key: 'sk-or-v1-abc', hash: KEY_HASH });
    });

    it('defaults limit_reset to monthly when omitted', async () => {
      post.mockResolvedValue({ data: { key: 'k', hash: KEY_HASH } });
      await service.createKey({ name: 'n', limit: 40 });
      expect(post.mock.calls[0][1].limit_reset).toBe('monthly');
    });

    it('throws BadGateway when OpenRouter omits key or hash', async () => {
      post.mockResolvedValue({ data: { hash: KEY_HASH } });
      await expect(service.createKey({ name: 'n', limit: 40 })).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });

    it('never logs the plaintext key or management key', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log');
      post.mockResolvedValue({ data: { key: 'sk-or-v1-secret', hash: KEY_HASH } });

      await service.createKey({ name: 'n', limit: 40 });

      const logged = logSpy.mock.calls.flat().join(' ');
      expect(logged).not.toContain('sk-or-v1-secret');
      expect(logged).not.toContain(MGMT_KEY);
      expect(logged).toContain(KEY_HASH);
    });
  });

  describe('raiseLimit', () => {
    it('PATCHes /keys/{hash} with the new absolute limit', async () => {
      patch.mockResolvedValue({ data: {} });

      await service.raiseLimit(KEY_HASH, 75);

      const [url, body, config] = patch.mock.calls[0];
      expect(url).toBe(`${OPENROUTER_API_BASE}/keys/${KEY_HASH}`);
      expect(body).toEqual({ limit: 75 });
      expectAuthHeader(config);
    });
  });

  describe('setDisabled', () => {
    it('PATCHes disabled:true', async () => {
      patch.mockResolvedValue({ data: {} });
      await service.setDisabled(KEY_HASH, true);
      expect(patch.mock.calls[0][1]).toEqual({ disabled: true });
    });

    it('PATCHes disabled:false to re-enable on renewal', async () => {
      patch.mockResolvedValue({ data: {} });
      await service.setDisabled(KEY_HASH, false);
      expect(patch.mock.calls[0][1]).toEqual({ disabled: false });
    });
  });

  describe('deleteKey', () => {
    it('DELETEs /keys/{hash}', async () => {
      del.mockResolvedValue({ data: { deleted: true } });
      await service.deleteKey(KEY_HASH);
      const [url, config] = del.mock.calls[0];
      expect(url).toBe(`${OPENROUTER_API_BASE}/keys/${KEY_HASH}`);
      expectAuthHeader(config);
    });
  });

  describe('getKey', () => {
    it('GETs /keys/{hash} and projects the fields', async () => {
      get.mockResolvedValue({
        data: { hash: KEY_HASH, name: 'k1', limit: 40, limit_reset: 'monthly', disabled: false, usage: 12.5 },
      });

      const key = await service.getKey(KEY_HASH);

      expect(get.mock.calls[0][0]).toBe(`${OPENROUTER_API_BASE}/keys/${KEY_HASH}`);
      expect(key).toEqual({
        hash: KEY_HASH,
        name: 'k1',
        limit: 40,
        limit_reset: 'monthly',
        disabled: false,
        usage: 12.5,
      });
    });
  });

  describe('error mapping + auth guard', () => {
    it('throws Unauthorized when the management key is not configured', async () => {
      service = new OpenRouterKeysService(null, OPENROUTER_API_BASE);
      await expect(service.createKey({ name: 'n', limit: 40 })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(post).not.toHaveBeenCalled();
    });

    it('maps 401/403 to Unauthorized (bad management key — not retried)', async () => {
      post.mockRejectedValue({ response: { status: 401 } });
      await expect(service.createKey({ name: 'n', limit: 40 })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('maps 404 to NotFound (key not found)', async () => {
      del.mockRejectedValue({ response: { status: 404 } });
      await expect(service.deleteKey(KEY_HASH)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('maps 5xx / network to BadGateway (transient — retried by callers)', async () => {
      patch.mockRejectedValue({ response: { status: 503 } });
      await expect(service.raiseLimit(KEY_HASH, 75)).rejects.toBeInstanceOf(BadGatewayException);
      patch.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(service.raiseLimit(KEY_HASH, 75)).rejects.toBeInstanceOf(BadGatewayException);
    });
  });
});
