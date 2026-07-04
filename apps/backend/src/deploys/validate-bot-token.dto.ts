import { z } from 'zod';

export const validateBotTokenSchema = z.object({
  bot_token: z
    .string()
    .min(1, 'bot_token is required')
    .regex(/^\d+:[\w-]+$/, 'bot_token must look like a Telegram bot token'),
});

export type ValidateBotTokenDto = z.infer<typeof validateBotTokenSchema>;
