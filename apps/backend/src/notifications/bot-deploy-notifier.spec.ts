import { BotDeployNotifier } from './bot-deploy-notifier';
import type { BotService } from '../bot/bot.service';

describe('BotDeployNotifier', () => {
  let bot: { sendMessage: jest.Mock };
  let notifier: BotDeployNotifier;

  beforeEach(() => {
    bot = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    notifier = new BotDeployNotifier(bot as unknown as BotService);
  });

  it('DMs the client with the bot handle when the deploy is ready', async () => {
    await notifier.deployReady(77n, 'coolbot');
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text] = bot.sendMessage.mock.calls[0];
    expect(chatId).toBe(77n);
    expect(text).toContain('@coolbot');
  });

  it('DMs the client with the reason when the deploy failed', async () => {
    await notifier.deployFailed(77n, 'boom');
    const [chatId, text] = bot.sendMessage.mock.calls[0];
    expect(chatId).toBe(77n);
    expect(text).toContain('boom');
  });

  it('DMs the client when the deploy is deleted', async () => {
    await notifier.deployDeleted(77n, 'coolbot');
    const [chatId, text] = bot.sendMessage.mock.calls[0];
    expect(chatId).toBe(77n);
    expect(text).toContain('@coolbot');
  });
});
