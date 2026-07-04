import { Bot, InlineKeyboard } from 'grammy';
import { BotService } from './bot.service';

const MINI_APP_URL = 'https://mini.example.com';
const BACKEND_URL = 'https://backend.example.com';

function makeMockBot(token = 'test-bot-token') {
  return {
    token,
    command: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    isRunning: jest.fn().mockReturnValue(false),
    api: { setWebhook: jest.fn().mockResolvedValue(undefined) },
  };
}

describe('BotService', () => {
  it('registers a /start handler', () => {
    const mockBot = makeMockBot();
    const service = new BotService(mockBot as unknown as Bot, MINI_APP_URL, false, BACKEND_URL);

    service.onModuleInit();

    expect(mockBot.command).toHaveBeenCalledWith('start', expect.any(Function));
  });

  it('/start handler replies with a WebApp button pointing at MINI_APP_URL', async () => {
    const mockBot = makeMockBot();
    const service = new BotService(mockBot as unknown as Bot, MINI_APP_URL, false, BACKEND_URL);
    service.onModuleInit();

    const handler = mockBot.command.mock.calls[0][1] as (ctx: unknown) => Promise<void>;
    const ctx = { reply: jest.fn().mockResolvedValue(undefined) };
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [text, options] = ctx.reply.mock.calls[0];
    expect(text).toContain('Hermes');
    const keyboard = options.reply_markup;
    const button = keyboard.inline_keyboard[0][0] as { web_app: { url: string } };
    expect(button.web_app.url).toBe(MINI_APP_URL);
  });

  it('starts long polling when useWebhook is false', () => {
    const mockBot = makeMockBot();
    const service = new BotService(mockBot as unknown as Bot, MINI_APP_URL, false, BACKEND_URL);

    service.onModuleInit();

    expect(mockBot.start).toHaveBeenCalled();
    expect(mockBot.api.setWebhook).not.toHaveBeenCalled();
    expect(service.getWebhookHandler()).toBeNull();
  });

  it('sets a webhook and exposes the handler when useWebhook is true', () => {
    const mockBot = makeMockBot('secret-token');
    const startMock = mockBot.start;
    const service = new BotService(mockBot as unknown as Bot, MINI_APP_URL, true, BACKEND_URL);

    service.onModuleInit();

    expect(mockBot.api.setWebhook).toHaveBeenCalledWith(`${BACKEND_URL}/bot/secret-token`);
    expect(startMock).not.toHaveBeenCalled();
    expect(service.getWebhookHandler()).not.toBeNull();
    expect(service.getWebhookSecret()).toBe('secret-token');
  });

  it('is a no-op when the bot is null (no BOT_TOKEN)', () => {
    const service = new BotService(null, MINI_APP_URL, false, BACKEND_URL);
    expect(() => service.onModuleInit()).not.toThrow();
    expect(service.getWebhookSecret()).toBeNull();
    expect(service.getWebhookHandler()).toBeNull();
  });

  it('stops the bot on module destroy', async () => {
    const mockBot = makeMockBot();
    const service = new BotService(mockBot as unknown as Bot, MINI_APP_URL, false, BACKEND_URL);
    service.onModuleInit();

    await service.onModuleDestroy();

    expect(mockBot.stop).toHaveBeenCalled();
  });

  it('does not throw on destroy when the bot is null', async () => {
    const service = new BotService(null, MINI_APP_URL, false, BACKEND_URL);
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('builds an InlineKeyboard with a webApp button (sanity)', () => {
    const kb = new InlineKeyboard().webApp('open', MINI_APP_URL);
    const button = kb.inline_keyboard[0][0] as { web_app: { url: string } };
    expect(button.web_app.url).toBe(MINI_APP_URL);
  });
});
