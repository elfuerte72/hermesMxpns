import { validateLlmKeySchema } from './validate-llm-key.dto';

describe('validateLlmKeySchema', () => {
  it('accepts the openrouter provider with just an api_key (catalog default model)', () => {
    const result = validateLlmKeySchema.safeParse({ provider_id: 'openrouter', api_key: 'sk-x' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown provider_id', () => {
    const result = validateLlmKeySchema.safeParse({ provider_id: 'gemini', api_key: 'sk-x' });
    expect(result.success).toBe(false);
  });

  it('requires base_url and model for the custom provider', () => {
    const result = validateLlmKeySchema.safeParse({ provider_id: 'custom', api_key: 'sk-x' });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['base_url', 'model']));
  });

  it('accepts openrouter with an explicit model override', () => {
    const result = validateLlmKeySchema.safeParse({
      provider_id: 'openrouter',
      api_key: 'sk-x',
      model: 'anthropic/claude-3.5-sonnet',
    });
    expect(result.success).toBe(true);
  });
});
