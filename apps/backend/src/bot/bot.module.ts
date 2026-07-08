import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { OpenRouterKeysModule } from '../openrouter-keys/openrouter-keys.module';
import { OpenRouterKeysService } from '../openrouter-keys/openrouter-keys.service';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';

@Module({
  imports: [PrismaModule, OpenRouterKeysModule],
  controllers: [BotController],
  providers: [
    {
      provide: BotService,
      inject: [ConfigService, PrismaService, OpenRouterKeysService],
      useFactory: (
        config: ConfigService,
        prisma: PrismaService,
        openRouterKeys: OpenRouterKeysService,
      ) => {
        const token = config.get<string>('BOT_TOKEN') ?? '';
        const miniAppUrl = config.getOrThrow<string>('MINI_APP_URL');
        const useWebhook = config.get<boolean>('BOT_USE_WEBHOOK') ?? false;
        const backendUrl = config.getOrThrow<string>('BACKEND_URL');
        const channelIdStr = config.get<string>('SUBSCRIPTION_CHANNEL_ID');
        const subscriptionChannelId = channelIdStr ? BigInt(channelIdStr) : null;
        const bot = token ? new Bot(token) : null;
        return new BotService(
          bot,
          miniAppUrl,
          useWebhook,
          backendUrl,
          prisma,
          subscriptionChannelId,
          openRouterKeys,
        );
      },
    },
  ],
  exports: [BotService],
})
export class BotModule {}
