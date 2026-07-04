import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisioningModule } from '../provisioning/provisioning.module';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeployNotifier } from '../workers/deploy-notifier';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [PrismaModule, ProvisioningModule, NotificationsModule],
  controllers: [WebhooksController],
  providers: [
    {
      provide: WebhooksService,
      inject: [PrismaService, ProvisioningService, DeployNotifier, ConfigService],
      useFactory: (
        prisma: PrismaService,
        provisioning: ProvisioningService,
        notifier: DeployNotifier,
        config: ConfigService,
      ) =>
        new WebhooksService(
          prisma,
          provisioning,
          notifier,
          config.get<boolean>('DRY_RUN') ?? true,
        ),
    },
  ],
})
export class WebhooksModule {}
