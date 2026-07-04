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
      provide: DeploysService,
      inject: [PrismaService, SecretsService, ValidateBotTokenService, DeployQueue],
      useFactory: (
        prisma: PrismaService,
        secrets: SecretsService,
        validateBotToken: ValidateBotTokenService,
        queue: DeployQueue,
      ) => new DeploysService(prisma, secrets, validateBotToken, queue),
    },
  ],
})
export class DeploysModule {}
