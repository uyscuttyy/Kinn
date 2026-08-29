import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableAutomationRecordRepository } from "../src/db/DurableAutomationRecordRepository.js";
import { DurableEventCursorRepository } from "../src/db/DurableEventCursorRepository.js";
import { DurableReminderRepository } from "../src/db/DurableReminderRepository.js";
import { JsonFileDocumentStore } from "../src/db/DocumentStore.js";
import type { AutomationRecord } from "../src/automation/AutomationWorker.js";
import type { ReminderSubscription } from "../src/reminders/ReminderService.js";

const makeContext = async () => {
  const directory = await mkdtemp(join(tmpdir(), "kinn-repos-"));
  return { directory, store: new JsonFileDocumentStore(directory) };
};

const record = (kind: AutomationRecord["kind"], success: boolean): AutomationRecord => ({
  candidateId: "vault-1", kind, success, detail: `${kind} attempt`, recordedAt: 1_000
});

const subscription = (id: string, enabled = true): ReminderSubscription => ({
  id, chatId: "chat-1", telegramUserId: "tg-1", deploymentKey: "base-sepolia", wallet: "0x2000000000000000000000000000000000000000", enabled
});

test("automation records survive a restart and are listed newest-first", async () => {
  const { store, directory } = await makeContext();
  const repository = new DurableAutomationRecordRepository(store);
  await repository.record(record("trigger", true));
  await repository.record(record("distribute", false));

  const reopened = new DurableAutomationRecordRepository(new JsonFileDocumentStore(directory));
  const recent = await reopened.recent();
  assert.deepEqual(recent.map((entry) => entry.kind), ["distribute", "trigger"]);
  assert.equal(await reopened.count(), 2);
  assert.ok(store.manifest().some((entry) => entry.name === "automation_records" && entry.source === "app_data"));
});

test("automation record history stays bounded", async () => {
  const { store } = await makeContext();
  const repository = new DurableAutomationRecordRepository(store);
  for (let index = 0; index < 20; index += 1) {
    await repository.record({ ...record("retry", true), recordedAt: index });
  }
  const recent = await repository.recent(5);
  assert.equal(recent.length, 5);
  assert.deepEqual(recent.map((entry) => entry.recordedAt), [19, 18, 17, 16, 15]);
});

test("the indexing cursor survives restarts and rejects invalid blocks", async () => {
  const { directory } = await makeContext();
  const first = new DurableEventCursorRepository(new JsonFileDocumentStore(directory), "base-sepolia");
  assert.equal(await first.get(), 0);
  await first.set(1_234);
  assert.equal(await first.get(), 1_234);

  const reopened = new DurableEventCursorRepository(new JsonFileDocumentStore(directory), "base-sepolia");
  assert.equal(await reopened.get(), 1_234);
  // A different network key keeps its own cursor.
  assert.equal(await new DurableEventCursorRepository(new JsonFileDocumentStore(directory), "base-mainnet").get(), 0);

  await assert.rejects(reopened.set(-1), /Invalid block number/);
  assert.equal(await reopened.get(), 1_234);
});

test("reminder subscriptions and deliveries persist across restarts", async () => {
  const { directory } = await makeContext();
  const first = new DurableReminderRepository(new JsonFileDocumentStore(directory));
  await first.save(subscription("sub-1"));
  await first.save({ ...subscription("sub-2"), enabled: false });
  await first.record("sub-1:1000:due", 1_000);

  const reopened = new DurableReminderRepository(new JsonFileDocumentStore(directory));
  assert.deepEqual((await reopened.listEnabled()).map((item) => item.id), ["sub-1"]);
  const found = await reopened.find("base-sepolia", "tg-1");
  assert.equal(found?.id, "sub-1");
  assert.equal(await reopened.has("sub-1:1000:due"), true);
  assert.equal(await reopened.has("missing"), false);

  await reopened.save({ ...subscription("sub-1"), enabled: false });
  assert.deepEqual(await reopened.listEnabled(), []);
});
