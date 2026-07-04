import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';

@Module({
  controllers: [BotController],
  providers: [
    {
      provide: BotService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const token = config.get<string>('BOT_TOKEN') ?? '';
        const miniAppUrl = config.getOrThrow<string>('MINI_APP_URL');
        const useWebhook = config.get<boolean>('BOT_USE_WEBHOOK') ?? false;
        const backendUrl = config.getOrThrow<string>('BACKEND_URL');
        const bot = token ? new Bot(token) : null;
        return new BotService(bot, miniAppUrl, useWebhook, backendUrl);
      },
    },
  ],
  exports: [BotService],
})
export class BotModule {}
