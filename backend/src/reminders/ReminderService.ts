import type { VaultStatus } from "../types.js";

export interface ReminderSubscription {
  id: string;
  chatId: string;
  telegramUserId: string;
  deploymentKey: string;
  wallet: string;
  enabled: boolean;
}

export interface ReminderSubscriptionRepository {
  listEnabled(): Promise<ReminderSubscription[]>;
  find(deploymentKey: string, telegramUserId: string): Promise<ReminderSubscription | undefined>;
  save(subscription: ReminderSubscription): Promise<void>;
}

export interface ReminderDeliveryRepository {
  has(key: string): Promise<boolean>;
  record(key: string, deliveredAt: number): Promise<void>;
}

export interface ReminderStatusReader {
  getVaultStatus(deploymentKey: string, wallet: string): Promise<VaultStatus>;
}

export interface ReminderNotifier {
  send(chatId: string, text: string): Promise<void>;
}

export class InMemoryReminderSubscriptionRepository implements ReminderSubscriptionRepository {
  constructor(private readonly subscriptions: ReminderSubscription[] = []) {}
  async listEnabled() { return this.subscriptions.filter((item) => item.enabled); }
  async find(deploymentKey: string, telegramUserId: string) {
    return this.subscriptions.find((item) => item.deploymentKey === deploymentKey && item.telegramUserId === telegramUserId);
  }
  async save(subscription: ReminderSubscription) {
    const index = this.subscriptions.findIndex((item) => item.id === subscription.id);
    if (index >= 0) this.subscriptions[index] = subscription;
    else this.subscriptions.push(subscription);
  }
}

export class InMemoryReminderDeliveryRepository implements ReminderDeliveryRepository {
  private readonly delivered = new Set<string>();
  async has(key: string) { return this.delivered.has(key); }
  async record(key: string) { this.delivered.add(key); }
}

export class ReminderService {
  static readonly DUE_SOON_SECONDS = 24 * 60 * 60;

  constructor(
    private readonly subscriptions: ReminderSubscriptionRepository,
    private readonly deliveries: ReminderDeliveryRepository,
    private readonly statusReader: ReminderStatusReader,
    private readonly notifier: ReminderNotifier,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000)
  ) {}

  async runOnce(): Promise<{ checked: number; sent: number; failures: number }> {
    const values = await this.subscriptions.listEnabled();
    let sent = 0;
    let failures = 0;
    for (const subscription of values) {
      try {
        const status = await this.statusReader.getVaultStatus(subscription.deploymentKey, subscription.wallet);
        const notification = this.notificationFor(subscription, status);
        if (!notification || await this.deliveries.has(notification.key)) continue;
        await this.notifier.send(subscription.chatId, notification.text);
        await this.deliveries.record(notification.key, this.now());
        sent += 1;
      } catch {
        failures += 1;
      }
    }
    return { checked: values.length, sent, failures };
  }

  private notificationFor(subscription: ReminderSubscription, status: VaultStatus) {
    if (status.vault.inheritanceTriggered || !status.vault.active) return undefined;
    const prefix = `${subscription.id}:${status.vault.lastCheckIn}`;
    if (status.inheritanceEligible) {
      return {
        key: `${prefix}:eligible`,
        text: `Your Kinn vault is now eligible for inheritance. Missed check-ins: ${status.missedCheckIns}/${status.vault.maxMissedCheckIns}. The contract remains the final authority.`
      };
    }
    if (status.missedCheckIns > 0) {
      const remaining = Math.max(0, status.vault.maxMissedCheckIns - status.missedCheckIns);
      return {
        key: `${prefix}:missed:${status.missedCheckIns}`,
        text: `You missed a Kinn check-in. Current missed count: ${status.missedCheckIns}/${status.vault.maxMissedCheckIns}. ${remaining} missed check-in${remaining === 1 ? "" : "s"} remaining before inheritance becomes eligible.`
      };
    }
    const secondsUntilDue = Number(status.nextExpectedCheckIn) - this.now();
    if (secondsUntilDue > 0 && secondsUntilDue <= ReminderService.DUE_SOON_SECONDS) {
      return {
        key: `${prefix}:due:${status.nextExpectedCheckIn}`,
        text: `Your Kinn check-in is due within 24 hours. Next check-in timestamp: ${status.nextExpectedCheckIn}. Open Kinn in Telegram and use /checkin to prepare the wallet transaction.`
      };
    }
    return undefined;
  }
}
