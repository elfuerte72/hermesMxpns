import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { SecretsModule } from '../secrets/secrets.module';
import { SecretsService } from '../secrets/secrets.service';
import { ProvisioningModule } from '../provisioning/provisioning.module';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { SubscriptionModule } from '../subscription/subscription.module';
import { SubscriptionService } from '../subscription/subscription.service';
import { ValidateBotTokenController } from './validate-bot-token.controller';
import { TELEGRAM_API_BASE, ValidateBotTokenService } from './validate-bot-token.service';
import { ValidateLlmKeyController } from './validate-llm-key.controller';
import { ValidateLlmKeyService } from './validate-llm-key.service';
import { DeploysController } from './deploys.controller';
import { DeploysService } from './deploys.service';
import { BullDeployQueue, DeployQueue } from './deploy-queue';
import { BullTeardownQueue, TeardownQueue } from './teardown-queue';

@Module({
  imports: [PrismaModule, AuthModule, SecretsModule, ProvisioningModule, SubscriptionModule],
  controllers: [ValidateBotTokenController, ValidateLlmKeyController, DeploysController],
  providers: [
    ValidateLlmKeyService,
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
      inject: [
        PrismaService,
        SecretsService,
        ValidateBotTokenService,
        DeployQueue,
        TeardownQueue,
        ProvisioningService,
        ValidateLlmKeyService,
        SubscriptionService,
        ConfigService,
      ],
      useFactory: (
        prisma: PrismaService,
        secrets: SecretsService,
        validateBotToken: ValidateBotTokenService,
        queue: DeployQueue,
        teardownQueue: TeardownQueue,
        provisioning: ProvisioningService,
        validateLlmKey: ValidateLlmKeyService,
        subscription: SubscriptionService,
        config: ConfigService,
      ) => {
        const channelIdStr = config.get<string>('SUBSCRIPTION_CHANNEL_ID');
        const channelId = channelIdStr ? BigInt(channelIdStr) : null;
        return new DeploysService(
          prisma,
          secrets,
          validateBotToken,
          queue,
          teardownQueue,
          provisioning,
          validateLlmKey,
          subscription,
          channelId,
        );
      },
    },
  ],
  exports: [ValidateBotTokenService, TeardownQueue],
})
export class DeploysModule {}
