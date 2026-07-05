import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
  type HttpException,
} from '@nestjs/common';
import axios from 'axios';
import {
  LLM_PROVIDERS,
  type ValidateLlmKeyErrorCode,
  type ValidateLlmKeyMissingFeature,
  type ValidateLlmKeyOkResponse,
} from '@hermes/shared';
import type { ValidateLlmKeyDto } from './validate-llm-key.dto';

export const LLM_KEY_CHECK_TIMEOUT_MS = 10_000;

const PING_MESSAGES = [{ role: 'user', content: 'ping' }];

type ProbeStream = NodeJS.ReadableStream & { destroy?: () => void };

@Injectable()
export class ValidateLlmKeyService {
  async validate(dto: ValidateLlmKeyDto): Promise<ValidateLlmKeyOkResponse> {
    const { baseUrl, model } = this.resolveTarget(dto);
    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers = { Authorization: `Bearer ${dto.api_key}` };

    try {
      await axios.post(
        url,
        { model, messages: PING_MESSAGES, max_tokens: 1 },
        { headers, timeout: LLM_KEY_CHECK_TIMEOUT_MS },
      );
    } catch (err) {
      throw this.mapError(err);
    }

    const supportsTools = await this.probeTools(url, headers, model);
    const supportsStreaming = await this.probeStreaming(url, headers, model);

    const missing: ValidateLlmKeyMissingFeature[] = [];
    if (!supportsTools) missing.push('tools');
    if (!supportsStreaming) missing.push('streaming');
    if (missing.length > 0) {
      throw new UnprocessableEntityException({
        ok: false,
        code: 'provider_incompatible',
        missing,
      });
    }

    return { ok: true, model, supports_tools: true, supports_streaming: true };
  }

  private resolveTarget(dto: ValidateLlmKeyDto): { baseUrl: string; model: string } {
    const provider = LLM_PROVIDERS.find((p) => p.id === dto.provider_id);
    if (!provider) {
      throw new BadRequestException(`Unknown provider "${dto.provider_id}"`);
    }
    const baseUrl = provider.id === 'custom' ? (dto.base_url ?? '') : provider.base_url;
    const model = dto.model ?? provider.default_model;
    if (!baseUrl || !model) {
      throw new BadRequestException('base_url and model are required for this provider');
    }
    return { baseUrl, model };
  }

  private async probeTools(
    url: string,
    headers: Record<string, string>,
    model: string,
  ): Promise<boolean> {
    try {
      await axios.post(
        url,
        {
          model,
          messages: PING_MESSAGES,
          max_tokens: 16,
          tools: [
            {
              type: 'function',
              function: { name: 'ping', parameters: { type: 'object', properties: {} } },
            },
          ],
          tool_choice: 'auto',
        },
        { headers, timeout: LLM_KEY_CHECK_TIMEOUT_MS },
      );
      return true;
    } catch (err) {
      if (this.responseStatus(err) !== null) return false;
      throw new BadGatewayException({ ok: false, code: 'provider_unreachable' });
    }
  }

  private async probeStreaming(
    url: string,
    headers: Record<string, string>,
    model: string,
  ): Promise<boolean> {
    let body: unknown;
    try {
      const res = await axios.post(
        url,
        { model, messages: PING_MESSAGES, max_tokens: 1, stream: true },
        { headers, timeout: LLM_KEY_CHECK_TIMEOUT_MS, responseType: 'stream' },
      );
      body = res.data;
    } catch (err) {
      if (this.responseStatus(err) !== null) return false;
      throw new BadGatewayException({ ok: false, code: 'provider_unreachable' });
    }
    if (!this.isReadable(body)) return true;
    return this.readFirstBytes(body);
  }

  private isReadable(value: unknown): value is ProbeStream {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as NodeJS.ReadableStream).once === 'function'
    );
  }

  private readFirstBytes(stream: ProbeStream): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (ok: boolean): void => {
        clearTimeout(timer);
        stream.destroy?.();
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), LLM_KEY_CHECK_TIMEOUT_MS);
      stream.once('data', () => done(true));
      stream.once('end', () => done(true));
      stream.once('error', () => done(false));
    });
  }

  private mapError(err: unknown): HttpException {
    const status = this.responseStatus(err);
    if (status === 401 || status === 403) return this.unprocessable('invalid_key');
    if (status === 402 || status === 429) return this.unprocessable('no_balance');
    if (status === 404) return this.unprocessable('model_unavailable');
    return new BadGatewayException({ ok: false, code: 'provider_unreachable' });
  }

  private unprocessable(code: ValidateLlmKeyErrorCode): HttpException {
    return new UnprocessableEntityException({ ok: false, code });
  }

  private responseStatus(err: unknown): number | null {
    if (typeof err === 'object' && err !== null && 'response' in err) {
      const response = (err as { response?: { status?: unknown } }).response;
      if (response && typeof response.status === 'number') return response.status;
    }
    return null;
  }
}
