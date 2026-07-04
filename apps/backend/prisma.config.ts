import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

type Env = {
  DATABASE_URL: string;
};

let dir = process.cwd();
for (let i = 0; i < 6; i += 1) {
  const candidate = resolve(dir, '.env');
  if (existsSync(candidate)) {
    config({ path: candidate });
    break;
  }
  dir = resolve(dir, '..');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env<Env>('DATABASE_URL'),
  },
});
