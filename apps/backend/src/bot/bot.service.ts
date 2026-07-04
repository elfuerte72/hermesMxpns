import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Bot, InlineKeyboard, webhookCallback } from 'grammy';

export type WebhookHandler = (req: unknown, res: unknown) => Promise<void>;

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private webhookHandler: WebhookHandler | null = null;

  constructor(
    private readonly bot: Bot | null,
    private readonly miniAppUrl: string,
    private readonly useWebhook: boolean,
    private readonly backendUrl: string,
  ) {}

  getWebhookSecret(): string | null {
    return this.bot?.token ?? null;
  }

  getWebhookHandler(): WebhookHandler | null {
    return this.webhookHandler;
  }

  onModuleInit(): void {
    if (!this.bot) {
      this.logger.warn('BOT_TOKEN is not set — entry bot is disabled.');
      return;
    }

    this.registerHandlers();

    if (this.useWebhook) {
      this.webhookHandler = webhookCallback(this.bot, 'express') as unknown as WebhookHandler;
      const url = `${this.backendUrl}/bot/${this.bot.token}`;
      void this.bot.api.setWebhook(url).catch((err: unknown) => {
        this.logger.error(`Failed to set webhook: ${String(err)}`);
      });
      this.logger.log(`Webhook mode: ${url.replace(this.bot.token, '***')}`);
    } else {
      void this.bot.start().catch((err: unknown) => {
        this.logger.error(`Bot polling failed: ${String(err)}`);
      });
      this.logger.log('Long-polling mode started.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      this.logger.log('Bot stopped.');
    }
  }

  private registerHandlers(): void {
    if (!this.bot) return;
    const keyboard = new InlineKeyboard().webApp('🚀 Открыть Mini App', this.miniAppUrl);

    this.bot.command('start', async (ctx) => {
      await ctx.reply(
        'Привет! Я разверну твоего Hermes-агента за пару кликов. Нажми кнопку ниже, чтобы открыть мини-приложение.',
        { reply_markup: keyboard },
      );
    });
  }
}
