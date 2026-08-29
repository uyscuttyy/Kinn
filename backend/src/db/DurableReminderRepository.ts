import type {
  ReminderDeliveryRepository,
  ReminderSubscription,
  ReminderSubscriptionRepository
} from "../reminders/ReminderService.js";
import { JsonFileDocumentStore } from "./DocumentStore.js";

const COLLECTION = "reminders";

interface ReminderDocument {
  subscriptions: ReminderSubscription[];
  deliveries: Record<string, number>;
}

const emptyDocument = (): ReminderDocument => ({ subscriptions: [], deliveries: {} });

/**
 * Durable reminder store (Phase 6, §9 `notifications`/`jobs` state).
 * Replaces the ad-hoc reminders JSON file: same read-modify-write semantics,
 * but on the shared atomic store with write serialization, so concurrent
 * reminder + automation workers can share the directory safely.
 */
export class DurableReminderRepository implements ReminderSubscriptionRepository, ReminderDeliveryRepository {
  constructor(private readonly store: JsonFileDocumentStore) {
    store.register(COLLECTION, "app_data", "Reminder subscriptions and delivery dedupe keys");
  }

  async listEnabled(): Promise<ReminderSubscription[]> {
    return (await this.read()).subscriptions.filter((item) => item.enabled);
  }

  async find(deploymentKey: string, telegramUserId: string): Promise<ReminderSubscription | undefined> {
    return (await this.read()).subscriptions.find(
      (item) => item.deploymentKey === deploymentKey && item.telegramUserId === telegramUserId
    );
  }

  async save(subscription: ReminderSubscription): Promise<void> {
    await this.update((data) => {
      const index = data.subscriptions.findIndex((item) => item.id === subscription.id);
      if (index >= 0) data.subscriptions[index] = subscription;
      else data.subscriptions.push(subscription);
    });
  }

  async has(key: string): Promise<boolean> {
    return (await this.read()).deliveries[key] !== undefined;
  }

  async record(key: string, deliveredAt: number): Promise<void> {
    await this.update((data) => {
      data.deliveries[key] = deliveredAt;
    });
  }

  private async read(): Promise<ReminderDocument> {
    return this.store.load<ReminderDocument>(COLLECTION, emptyDocument());
  }

  private async update(change: (data: ReminderDocument) => void): Promise<void> {
    await this.store.update<ReminderDocument>(COLLECTION, emptyDocument(), (data) => {
      change(data);
      return data;
    });
  }
}
