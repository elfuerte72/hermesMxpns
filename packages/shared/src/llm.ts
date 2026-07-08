export interface LlmProvider {
  id: string;
  name: string;
  base_url: string;
  key_env: string;
  default_model: string;
  docs_url: string | null;
}

export const LLM_PROVIDERS: readonly LlmProvider[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter (managed)',
    base_url: 'https://openrouter.ai/api/v1',
    key_env: 'OPENROUTER_API_KEY',
    default_model: 'openai/gpt-4o-mini',
    docs_url: 'https://openrouter.ai/keys',
  },
  {
    id: 'custom',
    name: 'Свой (OpenAI-compatible)',
    base_url: '',
    key_env: 'CUSTOM_API_KEY',
    default_model: '',
    docs_url: null,
  },
] as const;

export type LlmProviderId = (typeof LLM_PROVIDERS)[number]['id'];

export function isKnownLlmProvider(id: string): id is LlmProviderId {
  return LLM_PROVIDERS.some((p) => p.id === id);
}

export const VALIDATE_LLM_KEY_ERROR_CODES = [
  'invalid_key',
  'no_balance',
  'model_unavailable',
  'provider_incompatible',
  'provider_unreachable',
] as const;

export type ValidateLlmKeyErrorCode = (typeof VALIDATE_LLM_KEY_ERROR_CODES)[number];

export type ValidateLlmKeyMissingFeature = 'tools' | 'streaming';

export interface ValidateLlmKeyRequest {
  provider_id: string;
  api_key: string;
  base_url?: string;
  model?: string;
}

export interface ValidateLlmKeyOkResponse {
  ok: true;
  model: string;
  supports_tools: boolean;
  supports_streaming: boolean;
}

export interface ValidateLlmKeyErrorResponse {
  ok: false;
  code: ValidateLlmKeyErrorCode;
  missing?: ValidateLlmKeyMissingFeature[];
}
