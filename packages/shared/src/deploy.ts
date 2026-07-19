import type { HostingerDockerContainer, HostingerVmState } from './hostinger';

export type DeployStatus = 'pending' | 'creating' | 'configuring' | 'ready' | 'failed' | 'deleted';

/** Statuses that occupy a bot username (block re-use by another deploy). */
export const ACTIVE_DEPLOY_STATUSES: readonly DeployStatus[] = [
  'pending',
  'creating',
  'configuring',
  'ready',
];

export interface CreateDeployRequest {
  bot_token: string;
  /**
   * One-click bundle (default): omit both `llm_provider` and `llm_key` — the
   * backend wires `openrouter` and the worker mints a managed spend-capped key
   * (§23.9). Provide both only for the hidden BYOK "Advanced" path (`custom`).
   */
  llm_provider?: string;
  llm_key?: string;
  /** Required for the `custom` provider; ignored for catalog providers. */
  llm_base_url?: string;
  /** Optional model override; required for providers with no default model. */
  llm_model?: string;
}

export interface CreateDeployResponse {
  deploy_id: string;
  status: DeployStatus;
}

/** Public projection of a Deploy — never carries secrets. */
export interface DeployView {
  id: string;
  agent: string;
  bot_username: string;
  llm_provider: string;
  status: DeployStatus;
  vm_ip: string | null;
  /** Bot-token health (§23.8), independent of VM status: 'valid' | 'invalid' | null. */
  bot_token_status: BotTokenStatus | null;
  created_at: string;
  updated_at: string;
}

/** Bot-token health (independent of the VM DeployStatus — see §23.8). */
export type BotTokenStatus = 'valid' | 'invalid';

/** Response of POST /deploys/:id/restart. */
export interface RestartResponse {
  ok: true;
}

/** Body of PATCH /deploys/:id/llm-key — swap the agent's LLM provider/key. */
export interface UpdateLlmKeyRequest {
  provider_id: string;
  api_key: string;
  /** Required for the `custom` provider and providers without a default model. */
  base_url?: string;
  model?: string;
}

/** Response of PATCH /deploys/:id/llm-key. */
export interface UpdateLlmKeyResponse {
  ok: true;
}

/** Body of PATCH /deploys/:id/bot-token — swap the agent's Telegram bot token (§23.8). */
export interface UpdateBotTokenRequest {
  bot_token: string;
}

/** Response of PATCH /deploys/:id/bot-token. */
export interface UpdateBotTokenResponse {
  ok: true;
}

/**
 * Live agent state on the VPS, fetched on demand from Hostinger
 * (GET /deploys/:id/live-status). Tolerant snapshot: nulls/empties when the VM
 * or project is not created yet or already gone — not errors.
 */
export interface AgentLiveStatus {
  /** Hostinger VM state; null when the VM does not exist (yet or anymore). */
  vm_state: HostingerVmState | null;
  vm_ip: string | null;
  /** Containers of the Hermes Docker project; empty while the project is not visible. */
  containers: HostingerDockerContainer[];
  /** ISO timestamp of when this snapshot was taken. */
  checked_at: string;
}
