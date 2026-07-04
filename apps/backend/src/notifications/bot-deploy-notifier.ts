import { BotService } from '../bot/bot.service';
import { DeployNotifier } from '../workers/deploy-notifier';

/** DeployNotifier backed by the entry bot (DMs the client). No-ops if bot off. */
export class BotDeployNotifier extends DeployNotifier {
  constructor(private readonly bot: BotService) {
    super();
  }

  async deployFailed(telegramId: bigint, reason: string): Promise<void> {
    await this.bot.sendMessage(
      telegramId,
      `❌ Не получилось развернуть агента.\nПричина: ${reason}\nМы уже разбираемся — попробуйте позже или напишите в поддержку.`,
    );
  }

  async deployReady(telegramId: bigint, botUsername: string): Promise<void> {
    await this.bot.sendMessage(
      telegramId,
      `✅ Готово! Ваш Hermes-агент развёрнут.\nНапишите боту @${botUsername}, чтобы начать общение.`,
    );
  }
}
