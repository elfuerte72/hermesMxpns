import { z } from 'zod';

export const updateBotTokenSchema = z.object({
  bot_token: z
    .string()
    .min(1, 'bot_token is required')
    .regex(/^\d+:[\w-]+$/, 'bot_token must look like a Telegram bot token'),
});

export type UpdateBotTokenDto = z.infer<typeof updateBotTokenSchema>;
