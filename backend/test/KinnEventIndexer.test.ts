import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Interface } from "ethers";
import { KinnEventIndexer, type IndexerRpc, type VaultRegistry } from "../src/indexing/KinnEventIndexer.js";
import { DurableVaultEventRepository } from "../src/db/DurableVaultEventRepository.js";
import { JsonFileDocumentStore } from "../src/db/DocumentStore.js";
import { DurableEventCursorRepository } from "../src/db/DurableEventCursorRepository.js";
import { factoryAbi } from "../src/contracts/factoryAbi.js";
import { vaultAbi } from "../src/contracts/vaultAbi.js";
import type { ChainLog } from "../src/types.js";

const FACTORY = "0x1000000000000000000000000000000000000000";
const VAULT = "0x5000000000000000000000000000000000000000";
const OWNER = "0x2000000000000000000000000000000000000000";
const ALICE = "0x4000000000000000000000000000000000000000";
const TX_A = `0x${"a".repeat(64)}`;
const TX_B = `0x${"b".repeat(64)}`;

const factory = new Interface(factoryAbi);
const vault = new Interface(vaultAbi);

function factoryLog(txHash: string, logIndex: number, blockNumber: number, owner: string, vaultAddr: string): ChainLog {
  const encoded = factory.encodeEventLog(factory.getEvent("VaultCreated")!, [owner, vaultAddr, `0x${"1".repeat(64)}`]);
  return { address: FACTORY, topics: encoded.topics, data: encoded.data, blockNumber, transactionHash: txHash, index: logIndex };
}

function depositLog(txHash: string, logIndex: number, blockNumber: number, owner: string, token: string, amount: bigint): ChainLog {
  const encoded = vault.encodeEventLog(vault.getEvent("AssetDeposited")!, [owner, token, amount]);
  return { address: VAULT, topics: encoded.topics, data: encoded.data, blockNumber, transactionHash: txHash, index: logIndex };
}

function checkInLog(txHash: string, logIndex: number, blockNumber: number, owner: string): ChainLog {
  const encoded = vault.encodeEventLog(vault.getEvent("CheckedIn")!, [owner, 1234n]);
  return { address: VAULT, topics: encoded.topics, data: encoded.data, blockNumber, transactionHash: txHash, index: logIndex };
}

class MockRpc implements IndexerRpc {
  /** Logs returned per address for the CURRENT requested range. */
  readonly logs = new Map<string, ChainLog[]>();
  head = 100;
  /** When set, getLogs for this address throws (partial-failure path). */
  failFor?: string;
  lastRange = new Map<string, [number, number]>();

  async getLogs(address: string, fromBlock: number, toBlock: number): Promise<ChainLog[]> {
    if (this.failFor && address.toLowerCase() === this.failFor.toLowerCase()) {
      throw new Error("RPC getLogs failed");
    }
    this.lastRange.set(address.toLowerCase(), [fromBlock, toBlock]);
    return this.logs.get(address.toLowerCase()) ?? [];
  }

  async getBlockNumber(): Promise<number> { return this.head; }
}

const registry: VaultRegistry = { async listVaults() { return [VAULT]; } };

async function makeContext() {
  const directory = await mkdtemp(join(tmpdir(), "kinn-index-"));
  const store = new JsonFileDocumentStore(directory);
  const events = new DurableVaultEventRepository(store);
  const cursor = new DurableEventCursorRepository(store, "base-sepolia");
  const rpc = new MockRpc();
  const indexer = new KinnEventIndexer(rpc, FACTORY, registry, events, cursor, { startBlock: 10, confirmations: 2 });
  return { events, cursor, rpc, indexer, store, directory };
}
test("indexes factory and vault events, then re-runs idempotently via dedupe", async () => {
  const { rpc, indexer, events, cursor } = await makeContext();
  rpc.logs.set(FACTORY.toLowerCase(), [factoryLog(TX_A, 0, 15, OWNER, VAULT)]);
  rpc.logs.set(VAULT.toLowerCase(), [
    depositLog(TX_B, 0, 20, OWNER, ALICE, 500n),
    checkInLog(TX_B, 1, 20, OWNER)
  ]);
  rpc.head = 22; // safe head = 20 with 2 confirmations

  const first = await indexer.runOnce();
  assert.deepEqual(
    { from: first.fromBlock, to: first.toBlock, scanned: first.scanned, indexed: first.indexed },
    { from: 10, to: 20, scanned: 3, indexed: 3 }
  );
  assert.equal(await events.count(), 3);
  assert.equal(await cursor.get(), 20);

  // Second pass over the same range: dedupe keeps the store stable.
  const second = await indexer.runOnce();
  assert.equal(second.indexed, 0);
  assert.equal(await events.count(), 3);
});

test("applies confirmation depth and never indexes the unconfirmed head", async () => {
  const { rpc, indexer, cursor } = await makeContext();
  rpc.head = 50;
  const result = await indexer.runOnce();
  assert.equal(result.indexed, 0);
  assert.equal(result.toBlock, 48); // 50 - 2 confirmations
  const [from, to] = rpc.lastRange.get(FACTORY.toLowerCase())!;
  assert.deepEqual([from, to], [10, 48]);
  assert.equal(await cursor.get(), 48);
});

test("a partial getLogs failure leaves the cursor untouched", async () => {
  const { rpc, indexer, events, cursor } = await makeContext();
  rpc.logs.set(FACTORY.toLowerCase(), [factoryLog(TX_A, 0, 15, OWNER, VAULT)]);
  rpc.logs.set(VAULT.toLowerCase(), [depositLog(TX_B, 0, 20, OWNER, ALICE, 500n)]);
  rpc.head = 22;
  rpc.failFor = VAULT;

  // The pass aborts with the RPC error; the caller (worker) handles it.
  await assert.rejects(indexer.runOnce(), /RPC getLogs failed/);
  assert.equal(await cursor.get(), 0); // not advanced
  assert.equal(await events.count(), 0);

  rpc.failFor = undefined;
  const retry = await indexer.runOnce();
  assert.equal(retry.indexed, 2);
  assert.equal(await cursor.get(), 20);
});

test("batching caps the scanned range and advances the cursor per batch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kinn-index-"));
  const store = new JsonFileDocumentStore(directory);
  const events = new DurableVaultEventRepository(store);
  const cursor = new DurableEventCursorRepository(store, "net");
  const rpc = new MockRpc();
  rpc.head = 1000;
  const indexer = new KinnEventIndexer(rpc, FACTORY, registry, events, cursor, { startBlock: 0, maxBatchBlocks: 100 });

  const first = await indexer.runOnce();
  assert.deepEqual([first.fromBlock, first.toBlock], [1, 100]);
  assert.equal(await cursor.get(), 100);
  const second = await indexer.runOnce();
  assert.deepEqual([second.fromBlock, second.toBlock], [101, 200]);
  assert.equal(await cursor.get(), 200);
});

test("parses values with bigint-safe strings and extracts the indexed owner", async () => {
  const { rpc, indexer, events } = await makeContext();
  rpc.logs.set(FACTORY.toLowerCase(), [factoryLog(TX_A, 0, 15, OWNER, VAULT)]);
  rpc.logs.set(VAULT.toLowerCase(), [depositLog(TX_B, 0, 20, OWNER, ALICE, 1_250_000n)]);
  rpc.head = 22;
  await indexer.runOnce();

  const byOwner = await events.byOwner(OWNER);
  assert.equal(byOwner.length, 2);
  const deposit = byOwner.find((event) => event.name === "AssetDeposited")!;
  assert.equal(deposit.values.amount, "1250000");
  assert.equal(deposit.values.token, ALICE);
  assert.equal(deposit.owner, OWNER);
  assert.equal(deposit.address, VAULT);
  const created = byOwner.find((event) => event.name === "VaultCreated")!;
  assert.equal(created.address, FACTORY);
  assert.equal(created.values.vault, VAULT);
});

test("queries paginate newest-first and survive a store restart", async () => {
  const { rpc, indexer, directory } = await makeContext();
  const logs: ChainLog[] = [];
  for (let index = 0; index < 5; index += 1) {
    logs.push(depositLog(`0x${index.toString(16).padStart(64, "0")}`, 0, 20 + index, OWNER, ALICE, BigInt(index)));
  }
  rpc.logs.set(VAULT.toLowerCase(), logs);
  rpc.head = 30;
  await indexer.runOnce();

  const reopened = new DurableVaultEventRepository(new JsonFileDocumentStore(directory));
  const page1 = await reopened.byOwner(OWNER, 2);
  assert.deepEqual(page1.map((event) => event.values.amount), ["4", "3"]);
  const page2 = await reopened.byOwner(OWNER, 2, page1[page1.length - 1]!.key);
  assert.deepEqual(page2.map((event) => event.values.amount), ["2", "1"]);
  assert.equal(await reopened.count(), 5);
  const vaultOnly = await reopened.byVault(VAULT, 100);
  assert.equal(vaultOnly.length, 5);
});

test("unknown log topics are skipped without failing the pass", async () => {
  const { rpc, indexer, events } = await makeContext();
  const unknown: ChainLog = {
    address: VAULT,
    topics: [`0x${"f".repeat(64)}`],
    data: "0x",
    blockNumber: 20,
    transactionHash: TX_A,
    index: 9
  };
  rpc.logs.set(VAULT.toLowerCase(), [unknown, depositLog(TX_B, 1, 20, OWNER, ALICE, 5n)]);
  rpc.head = 22;
  const result = await indexer.runOnce();
  assert.equal(result.indexed, 1);
  assert.equal(await events.count(), 1);
});
