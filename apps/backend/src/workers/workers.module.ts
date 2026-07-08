import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisioningModule } from '../provisioning/provisioning.module';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { SecretsModule } from '../secrets/secrets.module';
import { SecretsService } from '../secrets/secrets.service';
import { OpenRouterKeysModule } from '../openrouter-keys/openrouter-keys.module';
import { OpenRouterKeysService } from '../openrouter-keys/openrouter-keys.service';
import { DeploysModule } from '../deploys/deploys.module';
import { ValidateBotTokenService } from '../deploys/validate-bot-token.service';
import { TeardownQueue } from '../deploys/teardown-queue';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeployNotifier } from './deploy-notifier';
import { DeployProcessor } from './deploy.processor';
import { DeployWorker } from './deploy.worker';
import { TeardownProcessor } from './teardown.processor';
import { TeardownWorker } from './teardown.worker';
import { ReconcileService } from './reconcile.service';
import { ReconcileScheduler } from './reconcile.scheduler';
import { StuckDeployService } from './stuck-deploy.service';
import { StuckDeployScheduler } from './stuck-deploy.scheduler';
import { TokenHealthcheckService } from './token-healthcheck.service';
import { TokenHealthcheckScheduler } from './token-healthcheck.scheduler';
import { SubscriptionExpiryService } from './subscription-expiry.service';
import { SubscriptionExpiryScheduler } from './subscription-expiry.scheduler';

/** Poll every 10s for up to ~10 min while the VM comes up. */
const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_ATTEMPTS = 60;
/** Fail deploys wedged in creating/configuring past this (> the 10-min poll). */
const PROVISION_TIMEOUT_MS = 20 * 60 * 1000;

@Module({
  imports: [
    PrismaModule,
    ProvisioningModule,
    SecretsModule,
    OpenRouterKeysModule,
    DeploysModule,
    NotificationsModule,
    ScheduleModule.forRoot(),
  ],
  providers: [
    {
      provide: DeployProcessor,
      inject: [
        PrismaService,
        ProvisioningService,
        SecretsService,
        DeployNotifier,
        ConfigService,
        OpenRouterKeysService,
      ],
      useFactory: (
        prisma: PrismaService,
        provisioning: ProvisioningService,
        secrets: SecretsService,
        notifier: DeployNotifier,
        config: ConfigService,
        openRouterKeys: OpenRouterKeysService,
      ) =>
        new DeployProcessor(prisma, provisioning, secrets, notifier, {
          dryRun: config.get<boolean>('DRY_RUN') ?? true,
          pollIntervalMs: POLL_INTERVAL_MS,
          pollMaxAttempts: POLL_MAX_ATTEMPTS,
          openrouterKeyLimitUsd: config.get<number>('OPENROUTER_KEY_LIMIT_USD') ?? 40,
          openrouterKeyLimitReset: (config.get<string>('OPENROUTER_KEY_LIMIT_RESET') ??
            'monthly') as 'daily' | 'weekly' | 'monthly',
        }, openRouterKeys),
    },
    {
      provide: DeployWorker,
      inject: [ConfigService, DeployProcessor],
      useFactory: (config: ConfigService, processor: DeployProcessor) =>
        new DeployWorker(
          config.getOrThrow<string>('REDIS_URL'),
          processor,
          config.get<boolean>('DEPLOY_WORKER_ENABLED') ?? true,
        ),
    },
    {
      provide: TeardownProcessor,
      inject: [PrismaService, ProvisioningService, DeployNotifier, ConfigService, OpenRouterKeysService],
      useFactory: (
        prisma: PrismaService,
        provisioning: ProvisioningService,
        notifier: DeployNotifier,
        config: ConfigService,
        openRouterKeys: OpenRouterKeysService,
      ) =>
        new TeardownProcessor(prisma, provisioning, notifier, {
          dryRun: config.get<boolean>('DRY_RUN') ?? true,
        }, openRouterKeys),
    },
    {
      provide: TeardownWorker,
      inject: [ConfigService, TeardownProcessor],
      useFactory: (config: ConfigService, processor: TeardownProcessor) =>
        new TeardownWorker(
          config.getOrThrow<string>('REDIS_URL'),
          processor,
          config.get<boolean>('DEPLOY_WORKER_ENABLED') ?? true,
        ),
    },
    {
      provide: ReconcileService,
      inject: [PrismaService, ProvisioningService, ConfigService],
      useFactory: (
        prisma: PrismaService,
        provisioning: ProvisioningService,
        config: ConfigService,
      ) =>
        new ReconcileService(prisma, provisioning, {
          dryRun: config.get<boolean>('DRY_RUN') ?? true,
          deleteOrphans: config.get<boolean>('RECONCILE_DELETE_ORPHANS') ?? false,
        }),
    },
    ReconcileScheduler,
    {
      provide: StuckDeployService,
      inject: [PrismaService, ProvisioningService, DeployNotifier, ConfigService],
      useFactory: (
        prisma: PrismaService,
        provisioning: ProvisioningService,
        notifier: DeployNotifier,
        config: ConfigService,
      ) =>
        new StuckDeployService(prisma, provisioning, notifier, {
          dryRun: config.get<boolean>('DRY_RUN') ?? true,
          timeoutMs: PROVISION_TIMEOUT_MS,
        }),
    },
    StuckDeployScheduler,
    {
      provide: TokenHealthcheckService,
      inject: [PrismaService, SecretsService, ValidateBotTokenService, ConfigService],
      useFactory: (
        prisma: PrismaService,
        secrets: SecretsService,
        validateBotToken: ValidateBotTokenService,
        config: ConfigService,
      ) =>
        new TokenHealthcheckService(prisma, secrets, validateBotToken, {
          dryRun: config.get<boolean>('DRY_RUN') ?? true,
        }),
    },
    TokenHealthcheckScheduler,
    {
      provide: SubscriptionExpiryService,
      inject: [PrismaService, TeardownQueue, ConfigService],
      useFactory: (prisma: PrismaService, teardownQueue: TeardownQueue, config: ConfigService) =>
        new SubscriptionExpiryService(prisma, teardownQueue, {
          graceDays: config.get<number>('SUBSCRIPTION_GRACE_DAYS') ?? 7,
          dryRun: config.get<boolean>('DRY_RUN') ?? true,
        }),
    },
    SubscriptionExpiryScheduler,
  ],
})
export class WorkersModule {}
