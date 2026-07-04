import { z } from 'zod';

export const deployReadySchema = z.object({
  deploy_id: z.string().min(1, 'deploy_id is required'),
});

export type DeployReadyDto = z.infer<typeof deployReadySchema>;

/** Extract the bearer token from an Authorization header. */
export function parseBearer(header: string | undefined): string {
  if (!header) return '';
  const prefix = 'Bearer ';
  return header.startsWith(prefix) ? header.slice(prefix.length).trim() : '';
}
