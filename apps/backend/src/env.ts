import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const envPath = resolve(dir, '.env');
    if (existsSync(envPath)) {
      config({ path: envPath });
      loaded = true;
      return;
    }
    dir = resolve(dir, '..');
  }
}

loadEnv();
