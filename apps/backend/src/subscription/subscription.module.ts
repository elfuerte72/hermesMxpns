import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { BotModule } from '../bot/bot.module';
import { BotService } from '../bot/bot.service';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

@Module({
  imports: [PrismaModule, BotModule, AuthModule],
  controllers: [SubscriptionController],
  providers: [
    {
      provide: SubscriptionService,
      inject: [PrismaService, BotService, ConfigService],
      useFactory: (
        prisma: PrismaService,
        bot: BotService,
        config: ConfigService,
      ) => {
        const channelIdStr = config.get<string>('SUBSCRIPTION_CHANNEL_ID');
        const channelId = channelIdStr ? BigInt(channelIdStr) : null;
        return new SubscriptionService(prisma, bot, channelId);
      },
    },
  ],
})
export class SubscriptionModule {}
