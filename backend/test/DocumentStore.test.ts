import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileDocumentStore } from "../src/db/DocumentStore.js";

const makeStore = async (): Promise<{ store: JsonFileDocumentStore; directory: string }> => {
  const directory = await mkdtemp(join(tmpdir(), "kinn-db-"));
  return { store: new JsonFileDocumentStore(directory), directory };
};

test("persists documents across store restarts", async () => {
  const { store, directory } = await makeStore();
  await store.save("things", { items: ["a", "b"], count: 2n });
  const reopened = new JsonFileDocumentStore(directory);
  assert.deepEqual(await reopened.load("things", { items: [], count: 0n }), { items: ["a", "b"], count: 2n });
});

test("returns the fallback for collections that were never written", async () => {
  const { store } = await makeStore();
  assert.deepEqual(await store.load("missing", { empty: true }), { empty: true });
});

test("round-trips big integers safely", async () => {
  const { store, directory } = await makeStore();
  const value = { amount: 12_345_678_901_234_567_890n, negative: -7n, plain: 3 };
  await store.save("amounts", value);
  const reopened = new JsonFileDocumentStore(directory);
  assert.deepEqual(await reopened.load("amounts", { amount: 0n, negative: 0n, plain: 0 }), value);
});

test("quarantines a corrupt file and recovers with the fallback instead of crashing", async () => {
  const { store, directory } = await makeStore();
  await rm(join(directory, "vault_cache.json"), { force: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(directory, "vault_cache.json"), "{ not valid json", { encoding: "utf8" });

  const reopened = new JsonFileDocumentStore(directory);
  assert.deepEqual(await reopened.load("vault_cache", { ok: false }), { ok: false });
  const files = await readdir(directory);
  assert.ok(files.some((name) => name.startsWith("vault_cache.json.corrupt-")), "corrupt file is quarantined");
});

test("serialized update keeps concurrent read-modify-write cycles consistent", async () => {
  const { store } = await makeStore();
  await Promise.all(
    Array.from({ length: 25 }, () =>
      store.update<{ value: number }>("counters", { value: 0 }, (current) => ({ value: current.value + 1 }))
    )
  );
  const final = await store.load<{ value: number }>("counters", { value: 0 });
  assert.equal(final.value, 25);
});

test("registered collections expose their source-of-truth flag", async () => {
  const { store } = await makeStore();
  store.register("reminders", "app_data", "Reminder subscriptions");
  store.register("vault_cache", "chain_mirror", "Cached on-chain vault projection");
  store.register("reminders", "app_data", "Reminder subscriptions"); // idempotent
  assert.deepEqual(store.manifest(), [
    { name: "reminders", source: "app_data", description: "Reminder subscriptions" },
    { name: "vault_cache", source: "chain_mirror", description: "Cached on-chain vault projection" }
  ]);
  assert.throws(() => store.register("reminders", "chain_mirror", "different"), /already registered/);
});

test("rejects collection names that would escape the store directory", async () => {
  const { store } = await makeStore();
  await assert.rejects(store.load("../escape", { value: 1 }), /Invalid collection name/);
  await assert.rejects(store.save("a/b", { value: 1 }), /Invalid collection name/);
});