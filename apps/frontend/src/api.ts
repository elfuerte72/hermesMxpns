import type {
  CreateDeployRequest,
  CreateDeployResponse,
  DeployView,
  LlmProvider,
  ValidateBotTokenResponse,
} from '@hermes/shared';
import { buildTmaAuthHeader } from '@hermes/shared';
import { getInitData } from './telegram';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
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
    throw new ApiError(res.status, await errorMessage(res));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'message' in body) {
      const msg = (body as { message: unknown }).message;
      if (typeof msg === 'string') return msg;
      if (Array.isArray(msg)) return msg.join(', ');
    }
  } catch {
    // fall through to status text
  }
  return res.statusText || `Request failed (${res.status})`;
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

export function createDeploy(body: CreateDeployRequest): Promise<CreateDeployResponse> {
  return request<CreateDeployResponse>('/deploys', { method: 'POST', body, auth: true });
}

export function getDeploy(id: string): Promise<DeployView> {
  return request<DeployView>(`/deploys/${id}`, { auth: true });
}
