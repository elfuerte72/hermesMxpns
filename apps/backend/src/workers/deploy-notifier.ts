import { Logger } from '@nestjs/common';

/**
 * Port for notifying the client about deploy outcomes. Consumed by the deploy
 * worker (failure) and the deploy-ready webhook (success). The bot-backed
 * implementation lives in ../notifications.
 */
export abstract class DeployNotifier {
  abstract deployFailed(telegramId: bigint, reason: string): Promise<void>;
  abstract deployReady(telegramId: bigint, botUsername: string): Promise<void>;
}

/** Logs only — used as a fallback and in tests. */
export class LoggingDeployNotifier extends DeployNotifier {
  private readonly logger = new Logger(LoggingDeployNotifier.name);

  deployFailed(telegramId: bigint, reason: string): Promise<void> {
    this.logger.warn(`deploy failed for user ${telegramId}: ${reason}`);
    return Promise.resolve();
  }

  deployReady(telegramId: bigint, botUsername: string): Promise<void> {
    this.logger.log(`deploy ready for user ${telegramId}: @${botUsername}`);
    return Promise.resolve();
  }
}
