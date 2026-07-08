/** OpenRouter Management API base (architecture §23.3). */
export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

export type OpenRouterLimitReset = 'daily' | 'weekly' | 'monthly' | null;

/** Result of `POST /api/v1/keys` — the plaintext `key` is returned only once. */
export interface OpenRouterCreatedKey {
  /** Plaintext API key — the caller must AES-256-GCM encrypt it before persisting. */
  key: string;
  /** Stable identifier used for subsequent PATCH/DELETE calls. */
  hash: string;
}

/** Projection of `GET /api/v1/keys/{hash}` used for usage/balance display. */
export interface OpenRouterKey {
  hash: string;
  name: string | null;
  limit: number | null;
  limit_reset: OpenRouterLimitReset;
  disabled: boolean;
  usage: number | null;
}
