import { Interface } from "ethers";
import { factoryAbi } from "../contracts/factoryAbi.js";
import { vaultAbi } from "../contracts/vaultAbi.js";
import type { ChainLog, ParsedKinnEvent } from "../types.js";
import type { IndexedVaultEvent } from "../db/DurableVaultEventRepository.js";
import type { DurableVaultEventRepository } from "../db/DurableVaultEventRepository.js";
import type { EventCursorRepository } from "../blockchain/KinnEventMonitor.js";

/** Minimal RPC surface the indexer needs. */
export interface IndexerRpc {
  getLogs(address: string, fromBlock: number, toBlock: number): Promise<ChainLog[]>;
  getBlockNumber(): Promise<number>;
}

/** Provides the vault instances whose logs should be indexed (factory registry). */
export interface VaultRegistry {
  listVaults(): Promise<string[]>;
}

export interface EventIndexerOptions {
  /** Factory deployment block; indexing starts here on a fresh cursor (§10). */
  startBlock?: number;
  /** Wait this many blocks behind head before indexing (confirmation depth). */
  confirmations?: number;
  /** Maximum blocks scanned per pass. */
  maxBatchBlocks?: number;
}

export interface IndexerRunResult {
  fromBlock: number;
  toBlock: number;
  scanned: number;
  indexed: number;
  vaults: number;
}

const factoryInterface = new Interface(factoryAbi);
const vaultInterface = new Interface(vaultAbi);

/**
 * Durable, restart-safe event indexer (Phase 8, ARCHITECTURE §10).
 *
 * - Polls from the durable cursor (factory deploy block on first run).
 * - Indexes factory logs (VaultCreated) and every registered vault's logs.
 * - Applies a confirmation depth; never indexes the unconfirmed head.
 * - Dedupes by (txHash, logIndex) at the repository, so cursor drift or a
 *   re-scan is idempotent.
 * - Never advances the cursor on partial failure: any getLogs error aborts the
 *   pass and the next pass re-scans the same range.
 */
export class KinnEventIndexer {
  constructor(
    private readonly rpc: IndexerRpc,
    private readonly factoryAddress: string,
    private readonly registry: VaultRegistry,
    private readonly events: DurableVaultEventRepository,
    private readonly cursor: EventCursorRepository,
    private readonly options: EventIndexerOptions = {}
  ) {}

  async runOnce(): Promise<IndexerRunResult> {
    const confirmations = Math.max(this.options.confirmations ?? 2, 0);
    const maxBatch = Math.max(this.options.maxBatchBlocks ?? 5_000, 1);
    const startBlock = this.options.startBlock ?? 0;

    const previous = await this.cursor.get();
    const head = await this.rpc.getBlockNumber();
    const safeHead = head - confirmations;
    const fromBlock = Math.max(previous + 1, startBlock);
    if (fromBlock > safeHead) {
      return { fromBlock, toBlock: previous, scanned: 0, indexed: 0, vaults: 0 };
    }
    const toBlock = Math.min(safeHead, fromBlock + maxBatch - 1);

    const vaults = await this.registry.listVaults();
    const addresses = [this.factoryAddress.toLowerCase(), ...vaults.map((vault) => vault.toLowerCase())];

    // Fetch all logs first; only persist + advance the cursor if every fetch
    // succeeded (never advance on partial failure).
    const logs: Array<ChainLog & { source: string }> = [];
    for (const address of addresses) {
      const batch = await this.rpc.getLogs(address, fromBlock, toBlock);
      for (const log of batch) logs.push({ ...log, source: address });
    }

    const parsed = logs
      .map((log) => this.parse(log))
      .filter((event): event is IndexedVaultEvent => event !== null);

    const indexed = await this.events.addAll(parsed);
    await this.cursor.set(toBlock);
    return { fromBlock, toBlock, scanned: logs.length, indexed, vaults: vaults.length };
  }

  /** Expose already-indexed events for the API layer. */
  repository(): DurableVaultEventRepository {
    return this.events;
  }

  private parse(log: ChainLog & { source: string }): IndexedVaultEvent | null {
    const isFactory = log.source.toLowerCase() === this.factoryAddress.toLowerCase();
    const contractInterface = isFactory ? factoryInterface : vaultInterface;
    let parsedLog: ReturnType<typeof contractInterface.parseLog> | null = null;
    try {
      parsedLog = contractInterface.parseLog({ topics: log.topics as string[], data: log.data });
    } catch {
      return null;
    }
    if (!parsedLog) return null;

    const values: Record<string, string | number | boolean> = {};
    parsedLog.fragment.inputs.forEach((input, index) => {
      const value = parsedLog!.args[index];
      values[input.name] = serializeValue(value);
    });

    const result: ParsedKinnEvent = {
      name: parsedLog.name,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      values
    };
    void result;

    const owner = parsedLog.fragment.inputs.some((input) => input.name === "owner" && input.indexed)
      ? String(parsedLog.args.getValue("owner"))
      : undefined;

    return {
      key: `${log.transactionHash.toLowerCase()}:${log.index}`,
      name: parsedLog.name,
      address: log.source,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      logIndex: log.index,
      values,
      ...(owner !== undefined ? { owner } : {})
    };
  }
}

function serializeValue(value: unknown): string | number | boolean {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return JSON.stringify(value.map(serializeValue));
  if (value !== null && typeof value === "object") {
    // Structs/objects: serialize each property with bigint safety.
    const out: Record<string, string | number | boolean> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = serializeValue(item);
    }
    return JSON.stringify(out);
  }
  return String(value);
}
