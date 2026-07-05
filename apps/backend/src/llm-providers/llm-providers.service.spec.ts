import { LlmProvidersService } from './llm-providers.service';

describe('LlmProvidersService', () => {
  let service: LlmProvidersService;

  beforeEach(() => {
    service = new LlmProvidersService();
  });

  it('returns the v2 catalog in UI order', () => {
    const list = service.list();
    const ids = list.map((p) => p.id);

    expect(ids).toEqual(['groq', 'proxyapi', 'vsegpt', 'openrouter', 'custom']);
    expect(list).toHaveLength(5);
  });

  it('every provider has the required fields filled (except custom base_url/model)', () => {
    for (const p of service.list()) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.key_env).toBeTruthy();
      if (p.id !== 'custom') {
        expect(p.base_url).toMatch(/^https?:\/\//);
      }
    }
  });

  it('groq has the verified base_url, key_env and default_model', () => {
    const groq = service.find('groq');
    expect(groq).toEqual({
      id: 'groq',
      name: 'Groq (бесплатно, без карты)',
      base_url: 'https://api.groq.com/openai/v1',
      key_env: 'GROQ_API_KEY',
      default_model: 'llama-3.3-70b-versatile',
      docs_url: expect.any(String),
    });
  });

  it('proxyapi uses the Hermes OPENAI_API_KEY + base_url mechanic', () => {
    const proxyapi = service.find('proxyapi');
    expect(proxyapi?.name).toBe('ProxyAPI (рубли, карта Мир)');
    expect(proxyapi?.base_url).toBe('https://api.proxyapi.ru/openai/v1');
    expect(proxyapi?.key_env).toBe('OPENAI_API_KEY');
    expect(proxyapi?.default_model).toBe('gpt-4o-mini');
  });

  it('vsegpt uses the Hermes OPENAI_API_KEY + base_url mechanic', () => {
    const vsegpt = service.find('vsegpt');
    expect(vsegpt?.name).toBe('VseGPT (рубли)');
    expect(vsegpt?.base_url).toBe('https://api.vsegpt.ru/v1');
    expect(vsegpt?.key_env).toBe('OPENAI_API_KEY');
    expect(vsegpt?.default_model).toBe('openai/gpt-4o-mini');
  });

  it('gemini and together are no longer in the catalog', () => {
    expect(service.find('gemini')).toBeNull();
    expect(service.find('together')).toBeNull();
  });

  it('custom provider has empty base_url and default_model (client-provided)', () => {
    const custom = service.find('custom');
    expect(custom?.base_url).toBe('');
    expect(custom?.default_model).toBe('');
    expect(custom?.key_env).toBe('CUSTOM_API_KEY');
  });

  it('returns a copy (mutating result does not affect catalog)', () => {
    const a = service.find('groq');
    a!.base_url = 'tampered';
    const b = service.find('groq');
    expect(b?.base_url).toBe('https://api.groq.com/openai/v1');
  });

  it('find returns null for an unknown provider', () => {
    expect(service.find('unknown')).toBeNull();
  });
});
