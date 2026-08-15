import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryReminderDeliveryRepository,
  InMemoryReminderSubscriptionRepository,
  ReminderService,
  type ReminderNotifier,
  type ReminderSubscription,
  type ReminderStatusReader
} from "../src/reminders/ReminderService.js";
import type { VaultStatus } from "../src/types.js";
import { FileReminderRepository } from "../src/reminders/FileReminderRepository.js";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const OWNER = "0x2000000000000000000000000000000000000000";
const subscription: ReminderSubscription = {
  id: "sub-1", chatId: "chat-1", telegramUserId: "tg-1", deploymentKey: "bot-testnet", wallet: OWNER, enabled: true
};

function status(overrides: Partial<VaultStatus> = {}): VaultStatus {
  return {
    vault: {
      owner: OWNER, lastCheckIn: 1_000n, checkInInterval: 604800n, maxMissedCheckIns: 3,
      active: true, inheritanceTriggered: false, automationReserve: 0n
    },
    beneficiaries: [], tokens: [], balances: {}, nextExpectedCheckIn: 604800n,
    missedCheckIns: 0, inheritanceEligible: false, ...overrides
  };
}

class FakeReader implements ReminderStatusReader {
  current = status();
  async getVaultStatus() { return this.current; }
}

class FakeNotifier implements ReminderNotifier {
  messages: string[] = [];
  async send(_chatId: string, text: string) { this.messages.push(text); }
}

test("sends a due-soon reminder and deduplicates repeated scans", async () => {
  const reader = new FakeReader();
  const notifier = new FakeNotifier();
  const service = new ReminderService(
    new InMemoryReminderSubscriptionRepository([subscription]),
    new InMemoryReminderDeliveryRepository(), reader, notifier, () => 604800 - 3600
  );
  assert.deepEqual(await service.runOnce(), { checked: 1, sent: 1, failures: 0 });
  assert.match(notifier.messages[0] ?? "", /due within 24 hours/);
  assert.deepEqual(await service.runOnce(), { checked: 1, sent: 0, failures: 0 });
  assert.equal(notifier.messages.length, 1);
});

test("reports missed count and remaining misses", async () => {
  const reader = new FakeReader();
  reader.current = status({ missedCheckIns: 2 });
  const notifier = new FakeNotifier();
  const service = new ReminderService(
    new InMemoryReminderSubscriptionRepository([subscription]),
    new InMemoryReminderDeliveryRepository(), reader, notifier, () => 700000
  );
  await service.runOnce();
  assert.match(notifier.messages[0] ?? "", /2\/3/);
  assert.match(notifier.messages[0] ?? "", /1 missed check-in remaining/);
});

test("reports eligibility and does not notify inactive or triggered vaults", async () => {
  const reader = new FakeReader();
  const notifier = new FakeNotifier();
  const service = new ReminderService(
    new InMemoryReminderSubscriptionRepository([subscription]),
    new InMemoryReminderDeliveryRepository(), reader, notifier, () => 700000
  );
  reader.current = status({ missedCheckIns: 3, inheritanceEligible: true });
  await service.runOnce();
  assert.match(notifier.messages[0] ?? "", /eligible for inheritance/);
  reader.current = status({ vault: { ...status().vault, active: false }, missedCheckIns: 3 });
  await service.runOnce();
  assert.equal(notifier.messages.length, 1);
});

test("isolates reader failures and continues scanning subscriptions", async () => {
  const second = { ...subscription, id: "sub-2", chatId: "chat-2", wallet: "0x3000000000000000000000000000000000000000" };
  const notifier = new FakeNotifier();
  const reader: ReminderStatusReader = {
    async getVaultStatus(_deployment, wallet) {
      if (wallet === second.wallet) throw new Error("RPC unavailable");
      return status({ missedCheckIns: 1 });
    }
  };
  const service = new ReminderService(
    new InMemoryReminderSubscriptionRepository([subscription, second]),
    new InMemoryReminderDeliveryRepository(), reader, notifier, () => 700000
  );
  assert.deepEqual(await service.runOnce(), { checked: 2, sent: 1, failures: 1 });
});

test("persists reminder subscriptions and delivery deduplication", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kinn-reminders-"));
  const path = join(directory, "reminders.json");
  const repository = new FileReminderRepository(path);
  await repository.save(subscription);
  assert.equal((await repository.listEnabled()).length, 1);
  assert.equal((await repository.find(subscription.deploymentKey, subscription.telegramUserId))?.wallet, OWNER);
  await repository.record("notice-1", 1234);
  assert.equal(await repository.has("notice-1"), true);
  const stored = JSON.parse(await readFile(path, "utf8"));
  assert.equal(stored.subscriptions[0].enabled, true);
});
