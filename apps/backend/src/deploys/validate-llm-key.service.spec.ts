jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn() } }));

import { PassThrough } from 'node:stream';
import axios from 'axios';
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LLM_KEY_CHECK_TIMEOUT_MS, ValidateLlmKeyService } from './validate-llm-key.service';

const post = axios.post as unknown as jest.Mock;

function sseStream(chunk: string | null = 'data: {}\n\n'): PassThrough {
  const stream = new PassThrough();
  if (chunk !== null) stream.write(chunk);
  stream.end();
  return stream;
}

function mockAllProbesOk(): void {
  post.mockImplementation((_url: string, body: { stream?: boolean }) => {
    if (body.stream) return Promise.resolve({ data: sseStream() });
    return Promise.resolve({ data: { choices: [] } });
  });
}

async function captureError(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (err) {
    return err as HttpException;
  }
  throw new Error('expected the promise to reject');
}

describe('ValidateLlmKeyService', () => {
  let service: ValidateLlmKeyService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ValidateLlmKeyService();
    mockAllProbesOk();
  });

  it('returns ok with the catalog default model when all three probes pass', async () => {
    const result = await service.validate({ provider_id: 'openrouter', api_key: 'sk-x' });

    expect(result).toEqual({
      ok: true,
      model: 'openai/gpt-4o-mini',
      supports_tools: true,
      supports_streaming: true,
    });
    expect(post).toHaveBeenCalledTimes(3);

    const [chatUrl, chatBody, chatConfig] = post.mock.calls[0];
    expect(chatUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(chatBody).toEqual({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    });
    expect(chatConfig).toEqual({
      headers: { Authorization: 'Bearer sk-x' },
      timeout: LLM_KEY_CHECK_TIMEOUT_MS,
    });

    const toolsBody = post.mock.calls[1][1];
    expect(toolsBody.tools).toEqual([
      { type: 'function', function: { name: 'ping', parameters: { type: 'object', properties: {} } } },
    ]);
    expect(toolsBody.tool_choice).toBe('auto');
    expect(toolsBody.max_tokens).toBe(16);

    const [, streamBody, streamConfig] = post.mock.calls[2];
    expect(streamBody.stream).toBe(true);
    expect(streamConfig.responseType).toBe('stream');
  });

  it('uses the body model override instead of the catalog default', async () => {
    await service.validate({ provider_id: 'openrouter', api_key: 'sk-p', model: 'gpt-4o' });

    expect(post.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(post.mock.calls[0][1].model).toBe('gpt-4o');
  });

  it('uses base_url and model from the body for the custom provider, stripping trailing slashes', async () => {
    await service.validate({
      provider_id: 'custom',
      api_key: 'sk-c',
      base_url: 'https://llm.example.com/v1/',
      model: 'my-model',
    });

    expect(post.mock.calls[0][0]).toBe('https://llm.example.com/v1/chat/completions');
    expect(post.mock.calls[0][1].model).toBe('my-model');
  });

  it.each([401, 403])('maps %i on the chat probe to 422 invalid_key', async (status) => {
    post.mockRejectedValue({ response: { status } });

    const err = await captureError(service.validate({ provider_id: 'openrouter', api_key: 'sk-bad' }));

    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getResponse()).toEqual({ ok: false, code: 'invalid_key' });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each([402, 429])('maps %i on the chat probe to 422 no_balance', async (status) => {
    post.mockRejectedValue({ response: { status } });

    const err = await captureError(service.validate({ provider_id: 'openrouter', api_key: 'sk-x' }));

    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getResponse()).toEqual({ ok: false, code: 'no_balance' });
  });

  it('maps 404 on the chat probe to 422 model_unavailable', async () => {
    post.mockRejectedValue({ response: { status: 404 } });

    const err = await captureError(
      service.validate({ provider_id: 'openrouter', api_key: 'sk-x', model: 'nope' }),
    );

    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getResponse()).toEqual({ ok: false, code: 'model_unavailable' });
  });

  it('maps a network error on the chat probe to 502 provider_unreachable', async () => {
    post.mockRejectedValue(new Error('ECONNREFUSED'));

    const err = await captureError(service.validate({ provider_id: 'openrouter', api_key: 'sk-x' }));

    expect(err).toBeInstanceOf(BadGatewayException);
    expect(err.getResponse()).toEqual({ ok: false, code: 'provider_unreachable' });
  });

  it('returns 422 provider_incompatible missing tools when the tool probe is rejected', async () => {
    post.mockImplementation((_url: string, body: { stream?: boolean; tools?: unknown[] }) => {
      if (body.tools) return Promise.reject({ response: { status: 400 } });
      if (body.stream) return Promise.resolve({ data: sseStream() });
      return Promise.resolve({ data: {} });
    });

    const err = await captureError(service.validate({ provider_id: 'openrouter', api_key: 'sk-x' }));

    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getResponse()).toEqual({
      ok: false,
      code: 'provider_incompatible',
      missing: ['tools'],
    });
  });

  it('returns 422 provider_incompatible missing streaming when the stream probe is rejected', async () => {
    post.mockImplementation((_url: string, body: { stream?: boolean }) => {
      if (body.stream) return Promise.reject({ response: { status: 400 } });
      return Promise.resolve({ data: {} });
    });

    const err = await captureError(service.validate({ provider_id: 'openrouter', api_key: 'sk-x' }));

    expect(err.getResponse()).toEqual({
      ok: false,
      code: 'provider_incompatible',
      missing: ['streaming'],
    });
  });

  it('reports both missing features when the tool and stream probes fail', async () => {
    post.mockImplementation((_url: string, body: { stream?: boolean; tools?: unknown[] }) => {
      if (body.tools || body.stream) return Promise.reject({ response: { status: 400 } });
      return Promise.resolve({ data: {} });
    });

    const err = await captureError(service.validate({ provider_id: 'openrouter', api_key: 'sk-x' }));

    expect(err.getResponse()).toEqual({
      ok: false,
      code: 'provider_incompatible',
      missing: ['tools', 'streaming'],
    });
  });

  it('marks streaming as missing when the SSE stream errors before any bytes', async () => {
    post.mockImplementation((_url: string, body: { stream?: boolean }) => {
      if (body.stream) {
        const stream = new PassThrough();
        process.nextTick(() => stream.destroy(new Error('boom')));
        return Promise.resolve({ data: stream });
      }
      return Promise.resolve({ data: {} });
    });

    const err = await captureError(service.validate({ provider_id: 'openrouter', api_key: 'sk-x' }));

    expect(err.getResponse()).toEqual({
      ok: false,
      code: 'provider_incompatible',
      missing: ['streaming'],
    });
  });

  it('maps a network error on the tool probe to 502 provider_unreachable', async () => {
    post.mockImplementation((_url: string, body: { tools?: unknown[] }) => {
      if (body.tools) return Promise.reject(new Error('socket hang up'));
      return Promise.resolve({ data: {} });
    });

    const err = await captureError(service.validate({ provider_id: 'openrouter', api_key: 'sk-x' }));

    expect(err).toBeInstanceOf(BadGatewayException);
    expect(err.getResponse()).toEqual({ ok: false, code: 'provider_unreachable' });
  });

  it('rejects a custom provider without base_url or model as a 400', async () => {
    const err = await captureError(
      service.validate({ provider_id: 'custom', api_key: 'sk-c', model: 'm' }),
    );

    expect(err).toBeInstanceOf(BadRequestException);
    expect(post).not.toHaveBeenCalled();
  });
});
