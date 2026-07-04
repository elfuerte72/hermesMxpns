import {
  HERMES_MEMORY_LIMIT,
  renderComposeFile,
  renderConfigYaml,
  renderEnvFile,
} from './hermes-config';

describe('renderEnvFile', () => {
  it('renders the Hermes .env with bot token, allowed user and LLM key', () => {
    const env = renderEnvFile({
      botToken: '123:abc',
      allowedUserId: '4242',
      keyEnv: 'GROQ_API_KEY',
      llmKey: 'sk-groq',
    });
    expect(env).toContain('TELEGRAM_BOT_TOKEN=123:abc');
    expect(env).toContain('TELEGRAM_ALLOWED_USERS=4242');
    expect(env).toContain('GROQ_API_KEY=sk-groq');
    expect(env).toContain('HERMES_DASHBOARD=1');
    expect(env.endsWith('\n')).toBe(true);
  });

  it('rejects values containing newlines (injection guard)', () => {
    expect(() =>
      renderEnvFile({ botToken: '1:a', allowedUserId: '1', keyEnv: 'K', llmKey: 'x\nEVIL=1' }),
    ).toThrow(/newlines/);
  });
});

describe('renderConfigYaml', () => {
  it('wires the provider as a custom_provider and sets the default model', () => {
    const yaml = renderConfigYaml({
      provider: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      keyEnv: 'GROQ_API_KEY',
      model: 'llama-3.3-70b-versatile',
    });
    expect(yaml).toContain('custom_providers:');
    expect(yaml).toContain('- name: "groq"');
    expect(yaml).toContain('base_url: "https://api.groq.com/openai/v1"');
    expect(yaml).toContain('key_env: "GROQ_API_KEY"');
    expect(yaml).toContain('default: "llama-3.3-70b-versatile"');
    expect(yaml).toContain('provider: "custom:groq"');
  });
});

describe('renderComposeFile', () => {
  it('renders the Hermes compose clamped to KVM 1 memory', () => {
    const compose = renderComposeFile();
    expect(compose).toContain('image: nousresearch/hermes-agent:latest');
    expect(compose).toContain('command: gateway run');
    expect(compose).toContain('"8642:8642"');
    expect(compose).toContain('"/root/.hermes:/opt/data"');
    expect(compose).toContain(`memory: ${HERMES_MEMORY_LIMIT}`);
    expect(HERMES_MEMORY_LIMIT).toBe('3G');
  });
});
