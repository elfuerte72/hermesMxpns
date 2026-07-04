import { z } from 'zod';

export const validateInitSchema = z.object({
  initData: z.string().min(1),
});

export type ValidateInitDto = z.infer<typeof validateInitSchema>;
