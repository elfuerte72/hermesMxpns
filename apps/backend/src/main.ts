import 'reflect-metadata';
import './env';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  // Optionally serve the built Mini App at /app (single-origin control-plane).
  const frontendDir = process.env.SERVE_FRONTEND_DIR;
  if (frontendDir) {
    app.useStaticAssets(frontendDir, { prefix: '/app' });
  }
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Backend listening on :${port}`);
}

void bootstrap();
