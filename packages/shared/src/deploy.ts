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
  /** One of LLM_PROVIDERS ids; validated server-side. */
  llm_provider: string;
  llm_key: string;
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
  created_at: string;
  updated_at: string;
}

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
