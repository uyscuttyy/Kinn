import type { TelegramTransport } from "../telegram/types.js";
import type { ReminderSubscriptionRepository } from "../reminders/ReminderService.js";
import type { AutomationCandidate, AutomationNotifier, AutomationRecord } from "./AutomationWorker.js";

export class TelegramAutomationNotifier implements AutomationNotifier {
  constructor(
    private readonly subscriptions: ReminderSubscriptionRepository,
    private readonly transport: TelegramTransport
  ) {}

  async notify(candidate: AutomationCandidate, record: AutomationRecord) {
    const subscriptions = await this.subscriptions.listEnabled();
    const targets = subscriptions.filter(
      (item) => item.deploymentKey === candidate.deploymentKey && item.wallet.toLowerCase() === candidate.owner.toLowerCase()
    );
    const hash = record.transactionHash ? `\nTransaction: ${record.transactionHash}` : "";
    await Promise.all(targets.map((target) => this.transport.sendMessage(
      target.chatId,
      `Kinn automation ${record.kind}: ${record.success ? "confirmed" : "failed"}.\n${record.detail}${hash}`
    )));
  }
}
