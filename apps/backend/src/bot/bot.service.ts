import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Bot, InlineKeyboard, webhookCallback } from 'grammy';

export type WebhookHandler = (req: unknown, res: unknown) => Promise<void>;

export const HERMES_GITHUB_URL = 'https://github.com/NousResearch/hermes-agent';
export const HERMES_SITE_URL = 'https://hermes-agent.nousresearch.com';

export const BOT_COMMANDS = [
  { command: 'start', description: 'Стартовое меню' },
  { command: 'help', description: 'Как это работает' },
] as const;

export const BOT_DESCRIPTION = [
  'Разверну твоего личного AI-агента Hermes (Nous Research) на отдельном VPS — прямо из Telegram, без SSH и кода.',
  '',
  '🤖 Агент пишет код, ищет в интернете, выполняет задачи 24/7',
  '🔒 Отдельный сервер и свои ключи — данные под контролем',
  '⚡️ Запуск за ~5 минут в пару кликов',
  '',
  'Жми «Начать»!',
].join('\n');

export const BOT_SHORT_DESCRIPTION =
  'Личный AI-агент Hermes на своём VPS за ~5 минут — прямо из Telegram, без SSH и кода.';

const START_MESSAGE = [
  '<b>HERMES AGENT</b> — личный AI-агент в твоём Telegram',
  '',
  'Разверну агента Hermes от Nous Research на отдельном VPS за ~5 минут:',
  '',
  '🤖 Свой бот-агент: пишет код, ищет в интернете, работает с файлами',
  '🔒 Отдельный сервер только под тебя — токены и переписка не уходят третьим лицам',
  '⚡️ Без SSH и терминала — всё в пару кликов из мини-приложения',
  '',
  'Жми кнопку — и поехали 👇',
].join('\n');

const HELP_MESSAGE = [
  '<b>Как это работает</b>',
  '',
  '1. Создай бота у @BotFather и скопируй его токен',
  '2. Открой Mini App, вставь токен и выбери LLM-провайдера',
  '3. Через ~5 минут твой Hermes-агент отвечает в Telegram',
  '',
  'Перезапуск, смена LLM-ключа и удаление — в разделе «Мои агенты» внутри Mini App.',
].join('\n');

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

  /** Send a DM to a chat. No-op (logged) when the entry bot is disabled. */
  async sendMessage(chatId: string | bigint, text: string): Promise<void> {
    if (!this.bot) {
      this.logger.warn(`Entry bot disabled — dropping message to ${chatId}`);
      return;
    }
    await this.bot.api.sendMessage(chatId.toString(), text);
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
    void this.setupBotProfile();

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

  private buildStartKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
      .webApp('🚀 Открыть Mini App', this.miniAppUrl)
      .row()
      .url('⭐ GitHub Hermes Agent', HERMES_GITHUB_URL)
      .row()
      .url('🌐 Сайт Hermes Agent', HERMES_SITE_URL);
  }

  private registerHandlers(): void {
    if (!this.bot) return;
    const keyboard = this.buildStartKeyboard();

    this.bot.command('start', async (ctx) => {
      await ctx.reply(START_MESSAGE, { reply_markup: keyboard, parse_mode: 'HTML' });
    });

    this.bot.command('help', async (ctx) => {
      await ctx.reply(HELP_MESSAGE, { reply_markup: keyboard, parse_mode: 'HTML' });
    });
  }

  /** Left-menu commands + profile texts ("what can this bot do?" and share blurb). Non-fatal. */
  private async setupBotProfile(): Promise<void> {
    if (!this.bot) return;
    const steps: Array<[string, Promise<unknown>]> = [
      ['setMyCommands', this.bot.api.setMyCommands([...BOT_COMMANDS])],
      ['setMyDescription', this.bot.api.setMyDescription(BOT_DESCRIPTION)],
      ['setMyShortDescription', this.bot.api.setMyShortDescription(BOT_SHORT_DESCRIPTION)],
    ];
    for (const [name, promise] of steps) {
      await promise.catch((err: unknown) => {
        this.logger.warn(`Bot profile setup step ${name} failed: ${String(err)}`);
      });
    }
  }
}
