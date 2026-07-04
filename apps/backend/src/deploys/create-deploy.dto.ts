import { z } from 'zod';
import { LLM_PROVIDERS, isKnownLlmProvider } from '@hermes/shared';

const providerIds = LLM_PROVIDERS.map((p) => p.id).join(', ');

export const createDeploySchema = z
  .object({
    bot_token: z
      .string()
      .min(1, 'bot_token is required')
      .regex(/^\d+:[\w-]+$/, 'bot_token must look like a Telegram bot token'),
    llm_provider: z
      .string()
      .min(1, 'llm_provider is required')
      .refine(isKnownLlmProvider, `llm_provider must be one of: ${providerIds}`),
    llm_key: z.string().min(1, 'llm_key is required'),
    llm_base_url: z.url('llm_base_url must be a valid URL').optional(),
    llm_model: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    // The `custom` provider has no catalog base_url — the client must supply one.
    if (val.llm_provider === 'custom' && !val.llm_base_url) {
      ctx.addIssue({
        code: 'custom',
        path: ['llm_base_url'],
        message: 'llm_base_url is required for the custom provider',
      });
    }
    // `custom` also has no default model.
    if (val.llm_provider === 'custom' && !val.llm_model) {
      ctx.addIssue({
        code: 'custom',
        path: ['llm_model'],
        message: 'llm_model is required for the custom provider',
      });
    }
  });

export type CreateDeployDto = z.infer<typeof createDeploySchema>;
