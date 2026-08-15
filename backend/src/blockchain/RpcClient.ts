import { JsonRpcProvider } from "ethers";
import type { ChainLog } from "../types.js";

export interface RpcClient {
  call(to: string, data: string): Promise<string>;
  getLogs(address: string, fromBlock: number, toBlock: number): Promise<ChainLog[]>;
  getBlockNumber(): Promise<number>;
}

export class EthersRpcClient implements RpcClient {
  readonly provider: JsonRpcProvider;

  constructor(rpcUrl: string) {
    this.provider = new JsonRpcProvider(rpcUrl);
  }

  async call(to: string, data: string): Promise<string> {
    return this.provider.call({ to, data });
  }

  async getLogs(address: string, fromBlock: number, toBlock: number): Promise<ChainLog[]> {
    const logs = await this.provider.getLogs({ address, fromBlock, toBlock });
    return logs.map((log) => ({
      address: log.address,
      topics: log.topics,
      data: log.data,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      index: log.index
    }));
  }

  getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }
}
