import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProvisioningModule } from './provisioning/provisioning.module';
import { SecretsModule } from './secrets/secrets.module';
import { AuthModule } from './auth/auth.module';
import { LlmProvidersModule } from './llm-providers/llm-providers.module';
import { BotModule } from './bot/bot.module';
import { DeploysModule } from './deploys/deploys.module';
import { WorkersModule } from './workers/workers.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    SecretsModule,
    ProvisioningModule,
    AuthModule,
    LlmProvidersModule,
    BotModule,
    DeploysModule,
    WorkersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
