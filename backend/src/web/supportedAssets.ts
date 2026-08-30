import { getAddress, Interface } from "ethers";
import { loadNetworkConfigs, type NetworkConfig } from "../deployments/loadNetworkConfigs.js";
import type { RpcClient } from "../blockchain/RpcClient.js";
import { ETH_SENTINEL } from "../contracts/vaultAbi.js";

/** A wallet-facing supported asset (API.md `GET /assets`). */
export interface SupportedAsset {
  symbol: string;
  address: string;
  decimals: number;
  /** true for native ETH. */
  native: boolean;
}

/** Fixed metadata for supported assets (BASE_INTEGRATION.md, verified). */
const FIXED_ASSETS: Record<string, { symbol: string; address: string; decimals: number; native: boolean }> = {
  "0x1111111111111111111111111111111111111111": { symbol: "ETH", address: ETH_SENTINEL, decimals: 18, native: true }
};

function envPrefix(key: string): string { return key.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase(); }

/**
 * Supported asset set for a network = native ETH + the USDC contract.
 * The USDC address is read from `KINN_<NET>_USDC` (per BASE_INTEGRATION.md)
 * and validated; unsupported/unknowable tokens are never claimed as supported.
 */
export function supportedAssets(
  network: NetworkConfig,
  env: NodeJS.ProcessEnv = process.env
): SupportedAsset[] {
  const usdcRaw = env[`KINN_${envPrefix(network.key)}_USDC`];
  if (!usdcRaw) throw new Error(`Missing KINN_${envPrefix(network.key)}_USDC for supported assets`);
  const usdc = getAddress(usdcRaw);
  return [
    { ...FIXED_ASSETS[ETH_SENTINEL]! },
    { symbol: "USDC", address: usdc, decimals: 6, native: false }
  ];
}

/** Raw (native units) balance of an asset for an address, via live eth_call. */
export async function rawBalanceOf(
  rpc: RpcClient,
  asset: SupportedAsset,
  account: string
): Promise<bigint> {
  if (asset.native) {
    if (!("getBalance" in rpc) || typeof rpc.getBalance !== "function") {
      throw new Error("RPC client does not support native balance lookups");
    }
    return rpc.getBalance(account);
  }
  const erc20 = new Interface(["function balanceOf(address) view returns (uint256)"]);
  const data = erc20.encodeFunctionData("balanceOf", [account]);
  const encoded = await rpc.call(asset.address, data);
  return erc20.decodeFunctionResult("balanceOf", encoded)[0] as bigint;
}
