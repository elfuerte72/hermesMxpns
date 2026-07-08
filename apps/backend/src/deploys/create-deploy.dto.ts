import { z } from 'zod';
import { isKnownLlmProvider } from '@hermes/shared';

const providerIds = ['openrouter', 'custom'].join(', ');

/**
 * One-click bundle (default): send only `bot_token` — the backend wires
 * `openrouter` and the worker mints a managed spend-capped key (§23.9).
 *
 * Hidden BYOK "Advanced" path: send `llm_provider` + `llm_key` (and, for
 * `custom`, `llm_base_url` + `llm_model`) to bring your own key.
 */
export const createDeploySchema = z
  .object({
    bot_token: z
      .string()
      .min(1, 'bot_token is required')
      .regex(/^\d+:[\w-]+$/, 'bot_token must look like a Telegram bot token'),
    llm_provider: z.string().min(1).optional(),
    llm_key: z.string().min(1).optional(),
    llm_base_url: z.url('llm_base_url must be a valid URL').optional(),
    llm_model: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    const byok = val.llm_provider != null || val.llm_key != null;
    if (!byok) return; // one-click — nothing else required

    if (!val.llm_provider) {
      ctx.addIssue({
        code: 'custom',
        path: ['llm_provider'],
        message: 'llm_provider is required when llm_key is given',
      });
    } else if (!isKnownLlmProvider(val.llm_provider)) {
      ctx.addIssue({
        code: 'custom',
        path: ['llm_provider'],
        message: `llm_provider must be one of: ${providerIds}`,
      });
    }
    if (!val.llm_key) {
      ctx.addIssue({
        code: 'custom',
        path: ['llm_key'],
        message: 'llm_key is required when llm_provider is given',
      });
    }
    // The `custom` provider has no catalog base_url/model — the client must supply both.
    if (val.llm_provider === 'custom' && !val.llm_base_url) {
      ctx.addIssue({
        code: 'custom',
        path: ['llm_base_url'],
        message: 'llm_base_url is required for the custom provider',
      });
    }
    if (val.llm_provider === 'custom' && !val.llm_model) {
      ctx.addIssue({
        code: 'custom',
        path: ['llm_model'],
        message: 'llm_model is required for the custom provider',
      });
    }
  });

export type CreateDeployDto = z.infer<typeof createDeploySchema>;
