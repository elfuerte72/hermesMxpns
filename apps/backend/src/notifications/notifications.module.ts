import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { BotService } from '../bot/bot.service';
import { DeployNotifier } from '../workers/deploy-notifier';
import { BotDeployNotifier } from './bot-deploy-notifier';

/** Provides the bot-backed DeployNotifier to the worker and the webhook. */
@Module({
  imports: [BotModule],
  providers: [
    {
      provide: DeployNotifier,
      inject: [BotService],
      useFactory: (bot: BotService) => new BotDeployNotifier(bot),
    },
  ],
  exports: [DeployNotifier],
})
export class NotificationsModule {}
