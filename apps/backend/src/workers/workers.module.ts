import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisioningModule } from '../provisioning/provisioning.module';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeployNotifier } from './deploy-notifier';
import { DeployProcessor } from './deploy.processor';
import { DeployWorker } from './deploy.worker';
import { TeardownProcessor } from './teardown.processor';
import { TeardownWorker } from './teardown.worker';

/** Poll every 10s for up to ~10 min while the VM comes up. */
const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_ATTEMPTS = 60;

@Module({
  imports: [PrismaModule, ProvisioningModule, NotificationsModule],
  providers: [
    {
      provide: DeployProcessor,
      inject: [PrismaService, ProvisioningService, DeployNotifier, ConfigService],
      useFactory: (
        prisma: PrismaService,
        provisioning: ProvisioningService,
        notifier: DeployNotifier,
        config: ConfigService,
      ) =>
        new DeployProcessor(prisma, provisioning, notifier, {
          backendUrl: config.getOrThrow<string>('BACKEND_URL'),
          dryRun: config.get<boolean>('DRY_RUN') ?? true,
          pollIntervalMs: POLL_INTERVAL_MS,
          pollMaxAttempts: POLL_MAX_ATTEMPTS,
        }),
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
      inject: [PrismaService, ProvisioningService, DeployNotifier, ConfigService],
      useFactory: (
        prisma: PrismaService,
        provisioning: ProvisioningService,
        notifier: DeployNotifier,
        config: ConfigService,
      ) =>
        new TeardownProcessor(prisma, provisioning, notifier, {
          dryRun: config.get<boolean>('DRY_RUN') ?? true,
        }),
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
  ],
})
export class WorkersModule {}
