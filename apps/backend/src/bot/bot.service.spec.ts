import { Bot, InlineKeyboard } from 'grammy';
import {
  BOT_COMMANDS,
  BOT_DESCRIPTION,
  BOT_SHORT_DESCRIPTION,
  BotService,
  HERMES_GITHUB_URL,
  HERMES_SITE_URL,
} from './bot.service';

const MINI_APP_URL = 'https://mini.example.com';
const BACKEND_URL = 'https://backend.example.com';
const CHANNEL_ID = -1001234567890n;

function makeMockBot(token = 'test-bot-token') {
  return {
    token,
    command: jest.fn(),
    on: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    isRunning: jest.fn().mockReturnValue(false),
    api: {
      setWebhook: jest.fn().mockResolvedValue(undefined),
      setMyCommands: jest.fn().mockResolvedValue(true),
      setMyDescription: jest.fn().mockResolvedValue(true),
      setMyShortDescription: jest.fn().mockResolvedValue(true),
      getChatMember: jest.fn().mockResolvedValue({ status: 'member' }),
    },
  };
}

function makeMockPrisma() {
  return {
    deploy: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeMockOpenRouterKeys() {
  return { setDisabled: jest.fn().mockResolvedValue(undefined) };
}

function makeService(
  bot: ReturnType<typeof makeMockBot> | null,
  useWebhook: boolean,
  channelId: bigint | null,
  prisma = makeMockPrisma(),
  openRouterKeys = makeMockOpenRouterKeys(),
): BotService {
  return new BotService(
    bot as unknown as Bot,
    MINI_APP_URL,
    useWebhook,
    BACKEND_URL,
    prisma as never,
    channelId,
    openRouterKeys as never,
  );
}

describe('BotService', () => {
  it('registers a /start handler', () => {
    const mockBot = makeMockBot();
    makeService(mockBot, false, CHANNEL_ID).onModuleInit();
    expect(mockBot.command).toHaveBeenCalledWith('start', expect.any(Function));
  });

  it('registers a /help handler', () => {
    const mockBot = makeMockBot();
    makeService(mockBot, false, CHANNEL_ID).onModuleInit();
    expect(mockBot.command).toHaveBeenCalledWith('help', expect.any(Function));
  });

  it('/start handler replies with WebApp, GitHub and site buttons', async () => {
    const mockBot = makeMockBot();
    makeService(mockBot, false, CHANNEL_ID).onModuleInit();

    const handler = mockBot.command.mock.calls[0][1] as (ctx: unknown) => Promise<void>;
    const ctx = { reply: jest.fn().mockResolvedValue(undefined) };
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [text, options] = ctx.reply.mock.calls[0];
    expect(text).toContain('Hermes');
    expect(options.parse_mode).toBe('HTML');
    const rows = options.reply_markup.inline_keyboard as Array<
      Array<{ web_app?: { url: string }; url?: string }>
    >;
    expect(rows[0][0].web_app?.url).toBe(MINI_APP_URL);
    const urls = rows.flat().map((b) => b.url);
    expect(urls).toContain(HERMES_GITHUB_URL);
    expect(urls).toContain(HERMES_SITE_URL);
  });

  it('sets bot commands and profile descriptions on init', () => {
    const mockBot = makeMockBot();
    makeService(mockBot, false, CHANNEL_ID).onModuleInit();

    expect(mockBot.api.setMyCommands).toHaveBeenCalledWith([...BOT_COMMANDS]);
    expect(mockBot.api.setMyDescription).toHaveBeenCalledWith(BOT_DESCRIPTION);
    expect(mockBot.api.setMyShortDescription).toHaveBeenCalledWith(BOT_SHORT_DESCRIPTION);
    expect(BOT_DESCRIPTION.length).toBeLessThanOrEqual(512);
    expect(BOT_SHORT_DESCRIPTION.length).toBeLessThanOrEqual(120);
  });

  it('starts long polling with chat_member allowed when useWebhook is false', () => {
    const mockBot = makeMockBot();
    makeService(mockBot, false, CHANNEL_ID).onModuleInit();

    expect(mockBot.start).toHaveBeenCalledWith({
      allowed_updates: expect.arrayContaining(['message', 'chat_member']),
    });
    expect(mockBot.api.setWebhook).not.toHaveBeenCalled();
  });

  it('sets a webhook with chat_member allowed and exposes the handler when useWebhook is true', () => {
    const mockBot = makeMockBot('secret-token');
    const startMock = mockBot.start;
    const service = makeService(mockBot, true, CHANNEL_ID);

    service.onModuleInit();

    expect(mockBot.api.setWebhook).toHaveBeenCalledWith(
      `${BACKEND_URL}/bot/secret-token`,
      expect.objectContaining({ allowed_updates: expect.arrayContaining(['chat_member']) }),
    );
    expect(startMock).not.toHaveBeenCalled();
    expect(service.getWebhookHandler()).not.toBeNull();
    expect(service.getWebhookSecret()).toBe('secret-token');
  });

  it('is a no-op when the bot is null (no BOT_TOKEN)', () => {
    const service = makeService(null, false, CHANNEL_ID);
    expect(() => service.onModuleInit()).not.toThrow();
    expect(service.getWebhookSecret()).toBeNull();
    expect(service.getWebhookHandler()).toBeNull();
  });

  it('stops the bot on module destroy', async () => {
    const mockBot = makeMockBot();
    const service = makeService(mockBot, false, CHANNEL_ID);
    service.onModuleInit();
    await service.onModuleDestroy();
    expect(mockBot.stop).toHaveBeenCalled();
  });

  it('does not throw on destroy when the bot is null', async () => {
    const service = makeService(null, false, CHANNEL_ID);
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('builds an InlineKeyboard with a webApp button (sanity)', () => {
    const kb = new InlineKeyboard().webApp('open', MINI_APP_URL);
    const button = kb.inline_keyboard[0][0] as { web_app: { url: string } };
    expect(button.web_app.url).toBe(MINI_APP_URL);
  });

  describe('chat_member subscription handler', () => {
    function memberCtx(status: string, chatId = Number(CHANNEL_ID), userId = 999) {
      return {
        chatMember: {
          chat: { id: chatId },
          new_chat_member: { user: { id: userId }, status },
        },
      };
    }

    it('registers a chat_member handler when the channel id is configured', () => {
      const mockBot = makeMockBot();
      makeService(mockBot, false, CHANNEL_ID).onModuleInit();
      expect(mockBot.on).toHaveBeenCalledWith('chat_member', expect.any(Function));
    });

    it('does not register a chat_member handler when subscription gating is disabled', () => {
      const mockBot = makeMockBot();
      makeService(mockBot, false, null).onModuleInit();
      expect(mockBot.on).not.toHaveBeenCalled();
    });

    it('syncs subscription_status to active (clearing expired_at) and enables managed keys', async () => {
      const mockBot = makeMockBot();
      const prisma = makeMockPrisma();
      const openRouterKeys = makeMockOpenRouterKeys();
      prisma.deploy.findMany.mockResolvedValue([{ openrouter_key_hash: 'hash-1' }]);
      makeService(mockBot, false, CHANNEL_ID, prisma, openRouterKeys).onModuleInit();

      const handler = mockBot.on.mock.calls[0][1] as (ctx: unknown) => Promise<void>;
      await handler(memberCtx('member'));

      expect(prisma.deploy.updateMany).toHaveBeenCalledWith({
        where: { user_id: 999n, subscription_channel_id: CHANNEL_ID },
        data: { subscription_status: 'active', subscription_expired_at: null },
      });
      expect(openRouterKeys.setDisabled).toHaveBeenCalledWith('hash-1', false);
    });

    it('syncs subscription_status to expired (stamping expired_at) and disables managed keys', async () => {
      const mockBot = makeMockBot();
      const prisma = makeMockPrisma();
      const openRouterKeys = makeMockOpenRouterKeys();
      prisma.deploy.findMany.mockResolvedValue([
        { openrouter_key_hash: 'hash-1' },
        { openrouter_key_hash: 'hash-2' },
      ]);
      makeService(mockBot, false, CHANNEL_ID, prisma, openRouterKeys).onModuleInit();

      const handler = mockBot.on.mock.calls[0][1] as (ctx: unknown) => Promise<void>;
      await handler(memberCtx('left'));

      const data = prisma.deploy.updateMany.mock.calls[0][0].data;
      expect(data.subscription_status).toBe('expired');
      expect(data.subscription_expired_at).toBeInstanceOf(Date);
      expect(openRouterKeys.setDisabled).toHaveBeenCalledWith('hash-1', true);
      expect(openRouterKeys.setDisabled).toHaveBeenCalledWith('hash-2', true);
    });

    it('does not touch the key when the status is none', async () => {
      const mockBot = makeMockBot();
      const prisma = makeMockPrisma();
      const openRouterKeys = makeMockOpenRouterKeys();
      makeService(mockBot, false, CHANNEL_ID, prisma, openRouterKeys).onModuleInit();

      const handler = mockBot.on.mock.calls[0][1] as (ctx: unknown) => Promise<void>;
      await handler(memberCtx('bogus'));

      expect(openRouterKeys.setDisabled).not.toHaveBeenCalled();
    });

    it('skips deploys without a managed key', async () => {
      const mockBot = makeMockBot();
      const prisma = makeMockPrisma();
      const openRouterKeys = makeMockOpenRouterKeys();
      prisma.deploy.findMany.mockResolvedValue([{ openrouter_key_hash: null }]);
      makeService(mockBot, false, CHANNEL_ID, prisma, openRouterKeys).onModuleInit();

      const handler = mockBot.on.mock.calls[0][1] as (ctx: unknown) => Promise<void>;
      await handler(memberCtx('left'));

      expect(openRouterKeys.setDisabled).not.toHaveBeenCalled();
    });

    it('ignores chat_member updates from other channels', async () => {
      const mockBot = makeMockBot();
      const prisma = makeMockPrisma();
      makeService(mockBot, false, CHANNEL_ID, prisma).onModuleInit();

      const handler = mockBot.on.mock.calls[0][1] as (ctx: unknown) => Promise<void>;
      await handler(memberCtx('member', -1009999999999));

      expect(prisma.deploy.updateMany).not.toHaveBeenCalled();
    });

    it('does not throw if the DB update fails (logs only)', async () => {
      const mockBot = makeMockBot();
      const prisma = makeMockPrisma();
      prisma.deploy.updateMany.mockRejectedValue(new Error('db down'));
      makeService(mockBot, false, CHANNEL_ID, prisma).onModuleInit();

      const handler = mockBot.on.mock.calls[0][1] as (ctx: unknown) => Promise<void>;
      await expect(handler(memberCtx('member'))).resolves.toBeUndefined();
    });
  });

  describe('getChatMember', () => {
    it('returns the membership status from the bot api', async () => {
      const mockBot = makeMockBot();
      mockBot.api.getChatMember.mockResolvedValue({ status: 'administrator' });
      const service = makeService(mockBot, false, CHANNEL_ID);

      const info = await service.getChatMember(CHANNEL_ID, 999n);

      expect(mockBot.api.getChatMember).toHaveBeenCalledWith(Number(CHANNEL_ID).toString(), 999);
      expect(info).toEqual({ status: 'administrator' });
    });

    it('returns null when the entry bot is disabled', async () => {
      const service = makeService(null, false, CHANNEL_ID);
      await expect(service.getChatMember(CHANNEL_ID, 999n)).resolves.toBeNull();
    });
  });
});
