import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import axios, { type AxiosRequestConfig } from 'axios';
import {
  OPENROUTER_API_BASE,
  type OpenRouterCreatedKey,
  type OpenRouterKey,
  type OpenRouterLimitReset,
} from '@hermes/shared';
import { errorStatus } from '../common/retry';

export const OPENROUTER_TIMEOUT_MS = 15_000;

export interface CreateKeyParams {
  name: string;
  limit: number;
  limitReset?: OpenRouterLimitReset;
}

interface OpenRouterKeyResponse {
  key?: string;
  hash?: string;
  name?: string | null;
  limit?: number | null;
  limit_reset?: OpenRouterLimitReset;
  disabled?: boolean;
  usage?: number | null;
}

/**
 * Thin wrapper over the OpenRouter Management API (architecture §23.3) that
 * mints per-user spend-capped keys and adjusts them over their lifecycle. The
 * plaintext key is returned by `createKey` only — the caller encrypts it before
 * it touches the DB. Neither the management key nor any plaintext key is ever
 * logged; only the stable `hash` appears in logs.
 */
@Injectable()
export class OpenRouterKeysService {
  private readonly logger = new Logger(OpenRouterKeysService.name);

  constructor(
    private readonly managementKey: string | null,
    private readonly baseUrl: string = OPENROUTER_API_BASE,
  ) {}

  /** `POST /api/v1/keys` — mint a new spend-capped key. Not idempotent: never retry. */
  async createKey(params: CreateKeyParams): Promise<OpenRouterCreatedKey> {
    const limitReset = params.limitReset ?? 'monthly';
    const data = await this.call('post', '/keys', {
      name: params.name,
      limit: params.limit,
      limit_reset: limitReset,
    });
    const key = data as OpenRouterKeyResponse;
    if (!key.key || !key.hash) {
      throw new BadGatewayException('OpenRouter did not return a usable key');
    }
    this.logger.log(`created key ${key.hash} (limit $${params.limit} ${limitReset})`);
    return { key: key.key, hash: key.hash };
  }

  /** `PATCH /api/v1/keys/{hash}` — raise the spend cap to a new absolute USD limit. */
  async raiseLimit(hash: string, limitUsd: number): Promise<void> {
    await this.call('patch', `/keys/${hash}`, { limit: limitUsd });
  }

  /** `PATCH /api/v1/keys/{hash}` — enable or disable a key without deleting it. */
  async setDisabled(hash: string, disabled: boolean): Promise<void> {
    await this.call('patch', `/keys/${hash}`, { disabled });
  }

  /** `DELETE /api/v1/keys/{hash}` — remove the key (called on teardown). */
  async deleteKey(hash: string): Promise<void> {
    await this.call('delete', `/keys/${hash}`);
  }

  /** `GET /api/v1/keys/{hash}` — fetch key details for usage/balance display. */
  async getKey(hash: string): Promise<OpenRouterKey> {
    const data = (await this.call('get', `/keys/${hash}`)) as OpenRouterKeyResponse;
    return {
      hash: data.hash ?? hash,
      name: data.name ?? null,
      limit: data.limit ?? null,
      limit_reset: data.limit_reset ?? null,
      disabled: data.disabled ?? false,
      usage: data.usage ?? null,
    };
  }

  private async call(
    method: 'post' | 'patch' | 'get' | 'delete',
    path: string,
    body?: unknown,
  ): Promise<OpenRouterKeyResponse> {
    if (!this.managementKey) {
      throw new UnauthorizedException('OPENROUTER_MANAGEMENT_KEY is not configured');
    }
    const url = `${this.baseUrl.replace(/\/+$/, '')}${path}`;
    const config: AxiosRequestConfig = {
      headers: { Authorization: `Bearer ${this.managementKey}` },
      timeout: OPENROUTER_TIMEOUT_MS,
    };
    try {
      if (method === 'get' || method === 'delete') {
        const res = await axios[method](url, config);
        return res.data as OpenRouterKeyResponse;
      }
      const res = await axios[method](url, body, config);
      return res.data as OpenRouterKeyResponse;
    } catch (err) {
      throw this.mapError(err);
    }
  }

  private mapError(err: unknown): Error {
    const status = errorStatus(err);
    if (status === 401 || status === 403) {
      return new UnauthorizedException('OpenRouter management key rejected');
    }
    if (status === 404) {
      return new NotFoundException('OpenRouter key not found');
    }
    return new BadGatewayException('OpenRouter request failed');
  }
}
