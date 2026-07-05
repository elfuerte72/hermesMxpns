import { z } from 'zod';
import { LLM_PROVIDERS, isKnownLlmProvider } from '@hermes/shared';

const providerIds = LLM_PROVIDERS.map((p) => p.id).join(', ');

export const validateLlmKeySchema = z
  .object({
    provider_id: z
      .string()
      .min(1, 'provider_id is required')
      .refine(isKnownLlmProvider, `provider_id must be one of: ${providerIds}`),
    api_key: z.string().min(1, 'api_key is required'),
    base_url: z.url('base_url must be a valid URL').optional(),
    model: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.provider_id === 'custom' && !val.base_url) {
      ctx.addIssue({
        code: 'custom',
        path: ['base_url'],
        message: 'base_url is required for the custom provider',
      });
    }
    const provider = LLM_PROVIDERS.find((p) => p.id === val.provider_id);
    if (provider && provider.default_model === '' && !val.model) {
      ctx.addIssue({
        code: 'custom',
        path: ['model'],
        message: 'model is required for this provider',
      });
    }
  });

export type ValidateLlmKeyDto = z.infer<typeof validateLlmKeySchema>;
