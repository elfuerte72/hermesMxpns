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
    name: 'Groq (бесплатно)',
    base_url: 'https://api.groq.com/openai/v1',
    key_env: 'GROQ_API_KEY',
    default_model: 'llama-3.3-70b-versatile',
    docs_url: 'https://console.groq.com/docs/api-keys',
  },
  {
    id: 'gemini',
    name: 'Google Gemini (free tier)',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    key_env: 'GEMINI_API_KEY',
    default_model: 'gemini-1.5-flash',
    docs_url: 'https://ai.google.dev/gemini-api/docs/api-key',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (есть free models)',
    base_url: 'https://openrouter.ai/api/v1',
    key_env: 'OPENROUTER_API_KEY',
    default_model: '',
    docs_url: 'https://openrouter.ai/keys',
  },
  {
    id: 'together',
    name: 'Together AI',
    base_url: 'https://api.together.xyz/v1',
    key_env: 'TOGETHER_API_KEY',
    default_model: 'meta-llama/Llama-3.1-70B-Instruct-Turbo',
    docs_url: 'https://docs.together.ai/docs/api-keys',
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
