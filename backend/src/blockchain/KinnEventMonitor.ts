import { Interface } from "ethers";
import { kinnAbi } from "../contracts/kinnAbi.js";
import type { ParsedKinnEvent } from "../types.js";
import type { RpcClient } from "./RpcClient.js";

export interface EventCursorRepository {
  get(): Promise<number>;
  set(blockNumber: number): Promise<void>;
}

export class InMemoryEventCursorRepository implements EventCursorRepository {
  constructor(private blockNumber = 0) {}
  async get() { return this.blockNumber; }
  async set(blockNumber: number) { this.blockNumber = blockNumber; }
}

export class KinnEventMonitor {
  private readonly contractInterface = new Interface(kinnAbi);

  constructor(
    private readonly rpc: RpcClient,
    private readonly contractAddress: string,
    private readonly cursor: EventCursorRepository
  ) {}

  async poll(toBlock?: number): Promise<ParsedKinnEvent[]> {
    const latest = toBlock ?? await this.rpc.getBlockNumber();
    const previous = await this.cursor.get();
    const fromBlock = previous + 1;
    if (fromBlock > latest) return [];
    const logs = await this.rpc.getLogs(this.contractAddress, fromBlock, latest);
    const events = logs.flatMap((log) => {
      const parsed = this.contractInterface.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed) return [];
      const values: Record<string, unknown> = {};
      parsed.fragment.inputs.forEach((input, index) => { values[input.name] = parsed.args[index]; });
      return [{ name: parsed.name, blockNumber: log.blockNumber, transactionHash: log.transactionHash, values }];
    });
    await this.cursor.set(latest);
    return events;
  }
}
