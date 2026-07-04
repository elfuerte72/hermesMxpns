import { LlmProvidersService } from './llm-providers.service';

describe('LlmProvidersService', () => {
  let service: LlmProvidersService;

  beforeEach(() => {
    service = new LlmProvidersService();
  });

  it('returns the full catalog with the documented providers', () => {
    const list = service.list();
    const ids = list.map((p) => p.id);

    expect(ids).toEqual(['groq', 'gemini', 'openrouter', 'together', 'custom']);
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
      name: 'Groq (бесплатно)',
      base_url: 'https://api.groq.com/openai/v1',
      key_env: 'GROQ_API_KEY',
      default_model: 'llama-3.3-70b-versatile',
      docs_url: expect.any(String),
    });
  });

  it('gemini uses the OpenAI-compatible endpoint', () => {
    const gemini = service.find('gemini');
    expect(gemini?.base_url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/');
    expect(gemini?.key_env).toBe('GEMINI_API_KEY');
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
