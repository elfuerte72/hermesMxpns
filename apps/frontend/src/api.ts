import type {
  CreateDeployRequest,
  CreateDeployResponse,
  DeployView,
  LlmProvider,
  RestartResponse,
  UpdateLlmKeyRequest,
  UpdateLlmKeyResponse,
  ValidateBotTokenResponse,
  ValidateLlmKeyOkResponse,
  ValidateLlmKeyRequest,
} from '@hermes/shared';
import { buildTmaAuthHeader } from '@hermes/shared';
import { getInitData } from './telegram';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Skip the ngrok free-tier interstitial when the API is behind a tunnel.
    'ngrok-skip-browser-warning': 'true',
  };
  if (opts.auth) headers.Authorization = buildTmaAuthHeader(getInitData());

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  if (!res.ok) {
    const { message, code } = await errorInfo(res);
    throw new ApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function errorInfo(res: Response): Promise<{ message: string; code: string | null }> {
  let message: string | null = null;
  let code: string | null = null;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      if ('code' in body && typeof (body as { code: unknown }).code === 'string') {
        code = (body as { code: string }).code;
      }
      if ('message' in body) {
        const msg = (body as { message: unknown }).message;
        if (typeof msg === 'string') message = msg;
        else if (Array.isArray(msg)) message = msg.join(', ');
      }
    }
  } catch {
    // fall through to status text
  }
  return { message: message ?? (res.statusText || `Request failed (${res.status})`), code };
}

export function fetchProviders(): Promise<LlmProvider[]> {
  return request<LlmProvider[]>('/llm-providers');
}

export function validateBotToken(botToken: string): Promise<ValidateBotTokenResponse> {
  return request<ValidateBotTokenResponse>('/validate-bot-token', {
    method: 'POST',
    body: { bot_token: botToken },
    auth: true,
  });
}

export function validateLlmKey(body: ValidateLlmKeyRequest): Promise<ValidateLlmKeyOkResponse> {
  return request<ValidateLlmKeyOkResponse>('/validate-llm-key', {
    method: 'POST',
    body,
    auth: true,
  });
}

export function createDeploy(body: CreateDeployRequest): Promise<CreateDeployResponse> {
  return request<CreateDeployResponse>('/deploys', { method: 'POST', body, auth: true });
}

export function getDeploy(id: string): Promise<DeployView> {
  return request<DeployView>(`/deploys/${id}`, { auth: true });
}

export function listDeploys(): Promise<DeployView[]> {
  return request<DeployView[]>('/deploys', { auth: true });
}

export function restartDeploy(id: string): Promise<RestartResponse> {
  return request<RestartResponse>(`/deploys/${id}/restart`, { method: 'POST', auth: true });
}

export function updateLlmKey(id: string, body: UpdateLlmKeyRequest): Promise<UpdateLlmKeyResponse> {
  return request<UpdateLlmKeyResponse>(`/deploys/${id}/llm-key`, {
    method: 'PATCH',
    body,
    auth: true,
  });
}

export function deleteDeploy(id: string): Promise<DeployView> {
  return request<DeployView>(`/deploys/${id}`, { method: 'DELETE', auth: true });
}
