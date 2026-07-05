/**
 * Pure renderers for the Hermes deployment files, pushed to the VPS via the
 * Hostinger Docker Manager API (compose content + project .env). Encodes the
 * config facts from architecture §5 (docker) and §7 (providers).
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

/** Render the project .env (Docker Manager `environment`) — injected into the container via env_file. */
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

/** Render config.yaml — provider wiring (§7), mounted to /opt/data/config.yaml. */
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

export interface ComposeFileParams {
  /** Rendered config.yaml content, embedded as an inline compose config. */
  configYaml: string;
  hostDir?: string;
}

/**
 * Render the docker-compose.yml sent to the Docker Manager API (§5, memory
 * clamped for KVM 1). config.yaml (no secrets) rides along as an inline
 * compose config mounted at /opt/data/config.yaml; secrets stay out of the
 * compose content and arrive via the project .env (`env_file`).
 */
export function renderComposeFile(p: ComposeFileParams): string {
  const hostDir = p.hostDir ?? HERMES_HOST_DIR;
  const configLines = p.configYaml.replace(/\n+$/, '').split('\n');
  return [
    'configs:',
    '  hermes_config:',
    '    content: |',
    ...configLines.map((line) => (line === '' ? '' : `      ${line}`)),
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
    '    env_file:',
    '      - .env',
    '    environment:',
    '      - HERMES_DASHBOARD=1',
    '    configs:',
    '      - source: hermes_config',
    '        target: /opt/data/config.yaml',
    '    deploy:',
    '      resources:',
    '        limits:',
    `          memory: ${HERMES_MEMORY_LIMIT}`,
    '          cpus: "2.0"',
    '',
  ].join('\n');
}
