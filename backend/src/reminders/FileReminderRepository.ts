import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ReminderDeliveryRepository,
  ReminderSubscription,
  ReminderSubscriptionRepository
} from "./ReminderService.js";

interface ReminderFile {
  subscriptions: ReminderSubscription[];
  deliveries: Record<string, number>;
}

const emptyFile = (): ReminderFile => ({ subscriptions: [], deliveries: {} });

export class FileReminderRepository implements ReminderSubscriptionRepository, ReminderDeliveryRepository {
  constructor(private readonly path: string) {}

  async listEnabled() { return (await this.read()).subscriptions.filter((item) => item.enabled); }

  async find(deploymentKey: string, telegramUserId: string) {
    return (await this.read()).subscriptions.find(
      (item) => item.deploymentKey === deploymentKey && item.telegramUserId === telegramUserId
    );
  }

  async save(subscription: ReminderSubscription) {
    await this.update((data) => {
      const index = data.subscriptions.findIndex((item) => item.id === subscription.id);
      if (index >= 0) data.subscriptions[index] = subscription;
      else data.subscriptions.push(subscription);
    });
  }

  async has(key: string) { return (await this.read()).deliveries[key] !== undefined; }

  async record(key: string, deliveredAt: number) {
    await this.update((data) => { data.deliveries[key] = deliveredAt; });
  }

  private async read(): Promise<ReminderFile> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Partial<ReminderFile>;
      return { subscriptions: parsed.subscriptions ?? [], deliveries: parsed.deliveries ?? {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
      throw error;
    }
  }

  private async update(change: (data: ReminderFile) => void) {
    const data = await this.read();
    change(data);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}
