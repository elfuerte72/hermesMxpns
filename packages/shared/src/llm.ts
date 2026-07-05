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
    id: 'groq',
    name: 'Groq (бесплатно, без карты)',
    base_url: 'https://api.groq.com/openai/v1',
    key_env: 'GROQ_API_KEY',
    default_model: 'llama-3.3-70b-versatile',
    docs_url: 'https://console.groq.com/docs/api-keys',
  },
  {
    id: 'proxyapi',
    name: 'ProxyAPI (рубли, карта Мир)',
    base_url: 'https://api.proxyapi.ru/openai/v1',
    key_env: 'OPENAI_API_KEY',
    default_model: 'gpt-4o-mini',
    docs_url: 'https://proxyapi.ru/docs',
  },
  {
    id: 'vsegpt',
    name: 'VseGPT (рубли)',
    base_url: 'https://api.vsegpt.ru/v1',
    key_env: 'OPENAI_API_KEY',
    default_model: 'openai/gpt-4o-mini',
    docs_url: 'https://vsegpt.ru/Docs/API',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (зарубежная карта/крипта)',
    base_url: 'https://openrouter.ai/api/v1',
    key_env: 'OPENROUTER_API_KEY',
    default_model: '',
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
