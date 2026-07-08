import { z } from 'zod';

export const topupSchema = z.object({
  deploy_id: z.string().min(1, 'deploy_id is required'),
  amount_usd: z.number().positive('amount_usd must be a positive number'),
});

export type TopupDto = z.infer<typeof topupSchema>;
