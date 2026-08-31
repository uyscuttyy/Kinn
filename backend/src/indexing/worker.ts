import { EthersRpcClient } from "../blockchain/RpcClient.js";
import { KinnContractService } from "../blockchain/KinnContractService.js";
import { DurableEventCursorRepository } from "../db/DurableEventCursorRepository.js";
import { DurableVaultEventRepository } from "../db/DurableVaultEventRepository.js";
import { createDocumentStore } from "../db/createDocumentStore.js";
import { loadNetworkConfigs } from "../deployments/loadNetworkConfigs.js";
import { KinnEventIndexer } from "./KinnEventIndexer.js";

function envPrefix(key: string): string { return key.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase(); }

const intervalMs = Number(process.env.KINN_INDEXER_INTERVAL_MS ?? "15000");
if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000) {
  throw new Error("KINN_INDEXER_INTERVAL_MS must be at least 1000");
}
const confirmations = Number(process.env.KINN_INDEX_CONFIRMATIONS ?? "2");
if (!Number.isSafeInteger(confirmations) || confirmations < 0) {
  throw new Error("KINN_INDEX_CONFIRMATIONS must be a non-negative integer");
}
const once = process.env.KINN_INDEXER_ONCE?.toLowerCase() === "true";

const documentStore = createDocumentStore();
const eventRepository = new DurableVaultEventRepository(documentStore);

for (const config of loadNetworkConfigs()) {
  const rpc = new EthersRpcClient(config.rpcUrl);
  const service = new KinnContractService(rpc, config.contractAddress, config.chainId);
  const cursor = new DurableEventCursorRepository(documentStore, config.key);
  const rawStart = process.env[`KINN_${envPrefix(config.key)}_START_BLOCK`];
  const startBlock = rawStart !== undefined && rawStart !== "" ? Number(rawStart) : undefined;
  const indexer = new KinnEventIndexer(rpc, config.contractAddress, service, eventRepository, cursor, {
    confirmations,
    ...(startBlock !== undefined && Number.isSafeInteger(startBlock) ? { startBlock } : {})
  });
  const result = await indexer.runOnce();
  console.log(
    `Indexed ${config.key}: scanned=${result.scanned} new=${result.indexed} vaults=${result.vaults} through block ${result.toBlock}`
  );
}

if (once) {
  console.log("Indexer single pass complete (KINN_INDEXER_ONCE=true).");
  process.exit(0);
}

let stopped = false;
process.once("SIGINT", () => { stopped = true; });
process.once("SIGTERM", () => { stopped = true; });
console.log(`Kinn event indexer started; interval ${intervalMs} ms`);
while (!stopped) {
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
  if (stopped) break;
  for (const config of loadNetworkConfigs()) {
    try {
      const rpc = new EthersRpcClient(config.rpcUrl);
      const service = new KinnContractService(rpc, config.contractAddress, config.chainId);
      const cursor = new DurableEventCursorRepository(documentStore, config.key);
      const indexer = new KinnEventIndexer(rpc, config.contractAddress, service, eventRepository, cursor, { confirmations });
      const result = await indexer.runOnce();
      console.log(
        `Indexed ${config.key}: scanned=${result.scanned} new=${result.indexed} vaults=${result.vaults} through block ${result.toBlock}`
      );
    } catch (error) {
      console.log(`Indexing pass failed for ${config.key}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
}