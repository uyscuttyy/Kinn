import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import { InMemoryEventCursorRepository, KinnEventMonitor } from "../src/blockchain/KinnEventMonitor.js";
import type { RpcClient } from "../src/blockchain/RpcClient.js";
import { kinnAbi } from "../src/contracts/kinnAbi.js";
import type { ChainLog } from "../src/types.js";

const CONTRACT = "0x1000000000000000000000000000000000000000";
const OWNER = "0x2000000000000000000000000000000000000000";
const EXECUTOR = "0x3000000000000000000000000000000000000000";

class EventRpc implements RpcClient {
  readonly iface = new Interface(kinnAbi);
  requestedRange?: [number, number];

  async call(): Promise<string> { throw new Error("not used"); }
  async getBlockNumber() { return 12; }
  async getLogs(_address: string, from: number, to: number): Promise<ChainLog[]> {
    this.requestedRange = [from, to];
    const event = this.iface.getEvent("InheritanceTriggered");
    assert(event);
    const encoded = this.iface.encodeEventLog(event, [OWNER, EXECUTOR, 1234n]);
    return [{
      address: CONTRACT,
      topics: encoded.topics,
      data: encoded.data,
      blockNumber: 12,
      transactionHash: `0x${"ab".repeat(32)}`,
      index: 0
    }];
  }
}

test("parses contract events and advances the durable cursor", async () => {
  const rpc = new EventRpc();
  const cursor = new InMemoryEventCursorRepository(9);
  const monitor = new KinnEventMonitor(rpc, CONTRACT, cursor);
  const events = await monitor.poll();
  assert.deepEqual(rpc.requestedRange, [10, 12]);
  assert.equal(events[0]?.name, "InheritanceTriggered");
  assert.equal(events[0]?.values.owner, OWNER);
  assert.equal(await cursor.get(), 12);
  assert.deepEqual(await monitor.poll(12), []);
});
