import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { SecretsModule } from '../secrets/secrets.module';
import { SecretsService } from '../secrets/secrets.service';
import { ValidateBotTokenController } from './validate-bot-token.controller';
import { TELEGRAM_API_BASE, ValidateBotTokenService } from './validate-bot-token.service';
import { DeploysController } from './deploys.controller';
import { DeploysService } from './deploys.service';
import { BullDeployQueue, DeployQueue } from './deploy-queue';
import { BullTeardownQueue, TeardownQueue } from './teardown-queue';

@Module({
  imports: [PrismaModule, AuthModule, SecretsModule],
  controllers: [ValidateBotTokenController, DeploysController],
  providers: [
    {
      provide: ValidateBotTokenService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new ValidateBotTokenService(prisma, TELEGRAM_API_BASE),
    },
    {
      provide: DeployQueue,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new BullDeployQueue(config.getOrThrow<string>('REDIS_URL')),
    },
    {
      provide: TeardownQueue,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new BullTeardownQueue(config.getOrThrow<string>('REDIS_URL')),
    },
    {
      provide: DeploysService,
      inject: [PrismaService, SecretsService, ValidateBotTokenService, DeployQueue, TeardownQueue],
      useFactory: (
        prisma: PrismaService,
        secrets: SecretsService,
        validateBotToken: ValidateBotTokenService,
        queue: DeployQueue,
        teardownQueue: TeardownQueue,
      ) => new DeploysService(prisma, secrets, validateBotToken, queue, teardownQueue),
    },
  ],
})
export class DeploysModule {}
