import { getAddress } from "ethers";

export interface BackendConfig {
  rpcUrl: string;
  contractAddress: string;
  chainId: number;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  if (!env.KINN_RPC_URL) throw new Error("KINN_RPC_URL is required");
  if (!env.KINN_CONTRACT_ADDRESS) throw new Error("KINN_CONTRACT_ADDRESS is required");
  const chainId = Number(env.KINN_CHAIN_ID);
  const port = Number(env.KINN_PORT ?? 3000);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("KINN_CHAIN_ID must be positive");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("KINN_PORT is invalid");
  return { rpcUrl: env.KINN_RPC_URL, contractAddress: getAddress(env.KINN_CONTRACT_ADDRESS), chainId, port };
}
