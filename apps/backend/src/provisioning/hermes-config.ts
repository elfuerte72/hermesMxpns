/**
 * Pure renderers for the three Hermes files the VPS writes into ~/.hermes.
 * Encodes the config facts from architecture §5 (docker) and §7 (providers).
 * These run server-side (at bootstrap time) so secrets never touch the
 * account-visible post-install script.
 */

/** Container memory limit tuned for KVM 1 (4 GB) — leaves headroom for the OS. */
export const HERMES_MEMORY_LIMIT = '3G';
/** Host directory that maps to the container's /opt/data. */
export const HERMES_HOST_DIR = '/root/.hermes';

export interface EnvFileParams {
  botToken: string;
  /** Telegram id(s) allowed to talk to the agent (the client). */
  allowedUserId: string;
  /** Provider-specific env var name, e.g. GROQ_API_KEY. */
  keyEnv: string;
  llmKey: string;
}

export interface ConfigYamlParams {
  provider: string;
  baseUrl: string;
  keyEnv: string;
  model: string;
}

/** Reject values that would break the KEY=VALUE / YAML line structure. */
function assertSingleLine(name: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${name} must not contain newlines`);
  }
}

/** Double-quote a YAML scalar, escaping backslashes and quotes. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Render ~/.hermes/.env — read by Hermes from its data volume. */
export function renderEnvFile(p: EnvFileParams): string {
  assertSingleLine('bot token', p.botToken);
  assertSingleLine('allowed user id', p.allowedUserId);
  assertSingleLine('key_env', p.keyEnv);
  assertSingleLine('llm key', p.llmKey);
  return [
    `TELEGRAM_BOT_TOKEN=${p.botToken}`,
    `TELEGRAM_ALLOWED_USERS=${p.allowedUserId}`,
    `${p.keyEnv}=${p.llmKey}`,
    'HERMES_DASHBOARD=1',
    '',
  ].join('\n');
}

/** Render ~/.hermes/config.yaml — provider wiring (§7). */
export function renderConfigYaml(p: ConfigYamlParams): string {
  return [
    'custom_providers:',
    `  - name: ${yamlString(p.provider)}`,
    `    base_url: ${yamlString(p.baseUrl)}`,
    `    key_env: ${yamlString(p.keyEnv)}`,
    'model:',
    `  default: ${yamlString(p.model)}`,
    `  provider: ${yamlString(`custom:${p.provider}`)}`,
    '',
  ].join('\n');
}

/** Render ~/.hermes/docker-compose.yml (§5, memory clamped for KVM 1). */
export function renderComposeFile(hostDir: string = HERMES_HOST_DIR): string {
  return [
    'services:',
    '  hermes:',
    '    image: nousresearch/hermes-agent:latest',
    '    restart: unless-stopped',
    '    command: gateway run',
    '    ports:',
    '      - "8642:8642"',
    '      - "9119:9119"',
    '    volumes:',
    `      - "${hostDir}:/opt/data"`,
    '    environment:',
    '      - HERMES_DASHBOARD=1',
    '    deploy:',
    '      resources:',
    '        limits:',
    `          memory: ${HERMES_MEMORY_LIMIT}`,
    '          cpus: "2.0"',
    '',
  ].join('\n');
}
