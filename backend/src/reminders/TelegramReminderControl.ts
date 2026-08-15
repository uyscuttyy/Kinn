import type { ReminderSubscriptionRepository } from "./ReminderService.js";
import type { TelegramReminderControl } from "../telegram/types.js";

export class RepositoryTelegramReminderControl implements TelegramReminderControl {
  constructor(private readonly repository: ReminderSubscriptionRepository) {}

  async enable(chatId: string, telegramUserId: string, deploymentKey: string, wallet: string) {
    const existing = await this.repository.find(deploymentKey, telegramUserId);
    await this.repository.save({
      id: existing?.id ?? `${deploymentKey}:${telegramUserId}`,
      chatId,
      telegramUserId,
      deploymentKey,
      wallet,
      enabled: true
    });
  }

  async disable(telegramUserId: string, deploymentKey: string) {
    const existing = await this.repository.find(deploymentKey, telegramUserId);
    if (existing) await this.repository.save({ ...existing, enabled: false });
  }

  async status(telegramUserId: string, deploymentKey: string) {
    return (await this.repository.find(deploymentKey, telegramUserId))?.enabled ?? false;
  }
}
