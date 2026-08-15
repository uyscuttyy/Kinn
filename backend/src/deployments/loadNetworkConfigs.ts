import { getAddress } from "ethers";

export type NetworkConfig = { key: string; chainId: number; contractAddress: string; rpcUrl: string };

function envPrefix(key: string): string { return key.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase(); }

export function loadNetworkConfigs(env: NodeJS.ProcessEnv = process.env): NetworkConfig[] {
  const keys = (env.KINN_NETWORKS ?? env.KINN_NETWORK_KEY ?? "xlayer-testnet")
    .split(",").map((key) => key.trim()).filter(Boolean);
  return keys.map((key) => {
    const prefix = envPrefix(key);
    const rpcUrl = env[`KINN_${prefix}_RPC_URL`] ?? (keys.length === 1 ? env.KINN_RPC_URL : undefined);
    const chainIdValue = env[`KINN_${prefix}_CHAIN_ID`] ?? (keys.length === 1 ? env.KINN_CHAIN_ID : undefined);
    const address = env[`KINN_${prefix}_CONTRACT_ADDRESS`] ?? (keys.length === 1 ? env.KINN_CONTRACT_ADDRESS : undefined);
    if (!rpcUrl || !chainIdValue || !address) throw new Error(`Missing configuration for network ${key}`);
    const chainId = Number(chainIdValue);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error(`Invalid chain ID for network ${key}`);
    return { key, chainId, rpcUrl, contractAddress: getAddress(address) };
  });
}
