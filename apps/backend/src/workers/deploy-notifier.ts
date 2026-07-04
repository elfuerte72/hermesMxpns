import { Logger } from '@nestjs/common';

/**
 * Port for notifying the client about deploy outcomes. Task 12 uses failure
 * notifications; Task 13 adds a bot-backed implementation for ready/failed DMs.
 */
export abstract class DeployNotifier {
  abstract deployFailed(telegramId: bigint, reason: string): Promise<void>;
}

/** Default no-op notifier — logs only. Replaced by the bot notifier in Task 13. */
export class LoggingDeployNotifier extends DeployNotifier {
  private readonly logger = new Logger(LoggingDeployNotifier.name);

  deployFailed(telegramId: bigint, reason: string): Promise<void> {
    this.logger.warn(`deploy failed for user ${telegramId}: ${reason}`);
    return Promise.resolve();
  }
}
