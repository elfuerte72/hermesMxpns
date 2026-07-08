import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthModule } from '../../auth/auth.module';
import { BotModule } from '../../bot/bot.module';
import { BotService } from '../../bot/bot.service';
import { OpenRouterKeysModule } from '../../openrouter-keys/openrouter-keys.module';
import { OpenRouterKeysService } from '../../openrouter-keys/openrouter-keys.service';
import { TopupController } from './topup.controller';
import { TopupService, parseTopupTiers } from './topup.service';

@Module({
  imports: [PrismaModule, AuthModule, BotModule, OpenRouterKeysModule],
  controllers: [TopupController],
  providers: [
    {
      provide: TopupService,
      inject: [PrismaService, OpenRouterKeysService, BotService, ConfigService],
      useFactory: (
        prisma: PrismaService,
        openRouterKeys: OpenRouterKeysService,
        bot: BotService,
        config: ConfigService,
      ) => {
        const tiers = parseTopupTiers(config.get<string>('TOPUP_TIERS'));
        const markup = config.get<number>('OPENROUTER_TOPUP_MARKUP_PERCENT') ?? 25;
        return new TopupService(prisma, openRouterKeys, bot, tiers, markup);
      },
    },
  ],
})
export class TopupModule {}
