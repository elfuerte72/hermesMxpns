import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  HOSTINGER_API_TOKEN: z.string().min(1),
  BOT_TOKEN: z.string().default(''),
  BOT_USE_WEBHOOK: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  TMA_AUTH_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86400),
  SERVE_FRONTEND_DIR: z.string().min(1).optional(),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),
  BACKEND_URL: z.string().url(),
  MINI_APP_URL: z.string().url(),
  DRY_RUN: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  DEPLOY_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  RECONCILE_DELETE_ORPHANS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Phase 6 — Tribute channel-membership gating (§23.2). Private channel "Hermes" id
  // (negative number, e.g. -1001234567890). Optional: unset in dev → subscription no-op.
  SUBSCRIPTION_CHANNEL_ID: z.string().optional(),
  // Phase 6 — OpenRouter Management API (§23.3). Operator secret; creates per-user
  // spend-capped keys. Optional in dev (calls throw Unauthorized until set).
  OPENROUTER_MANAGEMENT_KEY: z.string().optional(),
  // Per-user key spend cap in USD and its reset cadence (§23.5: $40 monthly).
  OPENROUTER_KEY_LIMIT_USD: z.coerce.number().positive().default(40),
  OPENROUTER_KEY_LIMIT_RESET: z
    .enum(['daily', 'weekly', 'monthly'])
    .default('monthly'),
  // Topup markup added on top of token cost when a user refills (§23.5: +25%).
  OPENROUTER_TOPUP_MARKUP_PERCENT: z.coerce.number().min(0).default(25),
  // Fixed topup tiers — JSON array of {amount_usd, channel_id, subscribe_url}
  // (§23 topup via Tribute tier-channel membership gating). Optional in dev.
  TOPUP_TIERS: z.string().optional(),
  // Days an expired subscription is kept (agent frozen, key disabled) before auto-teardown (§23.9).
  SUBSCRIPTION_GRACE_DAYS: z.coerce.number().int().min(0).default(7),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  return envSchema.parse(config);
}
