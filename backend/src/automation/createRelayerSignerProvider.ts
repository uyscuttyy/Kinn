import { JsonRpcProvider, Wallet } from "ethers";
import type { NetworkConfig } from "../deployments/loadNetworkConfigs.js";
import type { RelayerSigner, RelayerSignerProvider } from "./RelayerSigner.js";
import { EthersRelayerSigner, RemoteSigningServiceSigner } from "./RelayerSigner.js";

/** How the relayer's key is managed. Reported by `describeRelayerSigning`. */
export type RelayerSigningMode = "remote_signing_service" | "legacy_env_key";

export interface RelayerSignerProviderInfo {
  provider: RelayerSignerProvider;
  mode: RelayerSigningMode;
  /** Public relayer addresses per deployment key (safe to log/display). */
  addresses: Map<string, string>;
}

/**
 * Builds the managed-signer provider from the environment (ARCHITECTURE §14):
 *
 *  1. `KINN_RELAYER_SIGNER_URL` — remote signing service. The backend holds no
 *     key material at all; this is the production path.
 *     Optional: `KINN_RELAYER_SIGNER_TOKEN` bearer credential.
 *  2. `KINN_RELAYER_PRIVATE_KEY` — legacy testnet fallback: the key is read
 *     once into an in-memory ethers wallet and wrapped so it is unreachable
 *     from the `RelayerSigner` surface. Not a production path.
 *
 * Throws a clear error when neither is configured.
 */
export function createRelayerSignerProvider(
  env: NodeJS.ProcessEnv,
  networks: readonly NetworkConfig[]
): RelayerSignerProviderInfo {
  const remoteUrl = env.KINN_RELAYER_SIGNER_URL?.trim();
  if (remoteUrl) {
    const token = env.KINN_RELAYER_SIGNER_TOKEN?.trim() || undefined;
    const addresses = new Map<string, string>();
    const signers = new Map<string, RelayerSigner>();
    const address = env.KINN_RELAYER_ADDRESS?.trim();
    for (const network of networks) {
      const signer = new RemoteSigningServiceSigner(address ?? "managed", remoteUrl, network.chainId, token);
      signers.set(network.key, signer);
      addresses.set(network.key, signer.address);
    }
    return { provider: providerOf(signers), mode: "remote_signing_service", addresses };
  }

  const legacyKey = env.KINN_RELAYER_PRIVATE_KEY;
  if (legacyKey) {
    const signers = new Map<string, RelayerSigner>();
    const addresses = new Map<string, string>();
    for (const network of networks) {
      // The key lives only inside the wallet; `EthersRelayerSigner` exposes
      // just the address and send/wait.
      const wallet = new Wallet(legacyKey, new JsonRpcProvider(network.rpcUrl, network.chainId));
      const signer = new EthersRelayerSigner(wallet, network.chainId);
      signers.set(network.key, signer);
      addresses.set(network.key, wallet.address);
    }
    return { provider: providerOf(signers), mode: "legacy_env_key", addresses };
  }

  throw new Error(
    "No managed relayer signer is configured. Set KINN_RELAYER_SIGNER_URL (production signing service) " +
      "or KINN_RELAYER_PRIVATE_KEY (legacy testnet fallback)."
  );
}

function providerOf(signers: ReadonlyMap<string, RelayerSigner>): RelayerSignerProvider {
  return {
    get(deploymentKey: string): RelayerSigner {
      const signer = signers.get(deploymentKey);
      if (!signer) throw new Error(`No managed relayer signer configured for deployment: ${deploymentKey}`);
      return signer;
    }
  };
}
