import { LlmProvidersService } from './llm-providers.service';

describe('LlmProvidersService', () => {
  let service: LlmProvidersService;

  beforeEach(() => {
    service = new LlmProvidersService();
  });

  it('advertises only openrouter by default (one-click bundle)', () => {
    const ids = service.list().map((p) => p.id);
    expect(ids).toEqual(['openrouter']);
  });

  it('reveals the BYOK custom provider only in advanced mode', () => {
    const ids = service.list(true).map((p) => p.id);
    expect(ids).toEqual(['openrouter', 'custom']);
  });

  it('openrouter has the verified base_url, key_env and a default model', () => {
    const openrouter = service.find('openrouter');
    expect(openrouter).toEqual({
      id: 'openrouter',
      name: 'OpenRouter (managed)',
      base_url: 'https://openrouter.ai/api/v1',
      key_env: 'OPENROUTER_API_KEY',
      default_model: 'openai/gpt-4o-mini',
      docs_url: 'https://openrouter.ai/keys',
    });
  });

  it('custom is the hidden BYOK provider with empty base_url/model', () => {
    const custom = service.find('custom');
    expect(custom?.key_env).toBe('CUSTOM_API_KEY');
    expect(custom?.base_url).toBe('');
    expect(custom?.default_model).toBe('');
  });

  it('returns null for a removed provider id', () => {
    expect(service.find('groq')).toBeNull();
    expect(service.find('proxyapi')).toBeNull();
    expect(service.find('vsegpt')).toBeNull();
  });

  it('returns a fresh copy each time (no shared mutation)', () => {
    const a = service.find('openrouter');
    const b = service.find('openrouter');
    expect(b).not.toBe(a);
    expect(b?.base_url).toBe('https://openrouter.ai/api/v1');
  });
});
