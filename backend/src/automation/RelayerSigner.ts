/**
 * Managed relayer signing (Phase 6 milestone 6.3, ARCHITECTURE.md §14).
 *
 * Submission runs behind an injected `RelayerSubmitter` against a *managed
 * signer*. The key-management rules:
 *  - Key material lives only inside a signer implementation. The relayer
 *    submitter, the worker, and every caller only ever see `RelayerSigner`:
 *    an address plus `send`/`wait`. No path returns, logs, or stores the key.
 *  - Production uses a remote signing service (`RemoteSigningServiceSigner`):
 *    the backend never touches key material at all — it sends the unsigned
 *    payload, the service signs and broadcasts, and returns the hash.
 *  - The ethers-backed signer exists as the legacy testnet path; it wraps an
 *    in-memory key without exposing it on its public surface.
 */

import type { RelayerReceipt } from "./AutomationWorker.js";

/** A transaction the managed signer is asked to authorize and submit. */
export interface RelayerTransaction {
  to: string;
  data: string;
  value: string;
}

export interface RelayerSigner {
  /** Public address the relayer operates from (safe to log/display). */
  readonly address: string;
  /** Submit the transaction; resolves to the transaction hash. */
  send(transaction: RelayerTransaction): Promise<string>;
  /** Wait for confirmation depth and report the on-chain outcome. */
  wait(transactionHash: string): Promise<RelayerReceipt>;
}

export interface RelayerSignerProvider {
  get(deploymentKey: string): RelayerSigner;
}

/** Minimal structural surface of an ethers Wallet/Signer (kept narrow for tests). */
export interface EthersSignerLike {
  readonly address: string;
  readonly provider: {
    getNetwork(): Promise<{ chainId: bigint }>;
    waitForTransaction(hash: string): Promise<{ blockNumber: number; status: number | bigint | null } | null>;
  } | null;
  sendTransaction(transaction: { to: string; data: string; value: bigint }): Promise<{ hash: string }>;
}

/** Wraps an ethers signer without exposing its key on the RelayerSigner surface. */
export class EthersRelayerSigner implements RelayerSigner {
  constructor(
    private readonly signer: EthersSignerLike,
    private readonly expectedChainId: number
  ) {}

  get address(): string {
    return this.signer.address;
  }

  async send(transaction: RelayerTransaction): Promise<string> {
    if (!this.signer.provider) throw new Error(`Relayer signer has no provider: ${this.signer.address}`);
    const network = await this.signer.provider.getNetwork();
    if (network.chainId !== BigInt(this.expectedChainId)) {
      throw new Error(`Relayer chain ID mismatch: expected ${this.expectedChainId}, provider reported ${network.chainId}`);
    }
    const response = await this.signer.sendTransaction({
      to: transaction.to,
      data: transaction.data,
      value: BigInt(transaction.value)
    });
    return response.hash;
  }

  async wait(transactionHash: string): Promise<RelayerReceipt> {
    if (!this.signer.provider) throw new Error(`Relayer signer has no provider: ${this.signer.address}`);
    const receipt = await this.signer.provider.waitForTransaction(transactionHash);
    if (!receipt) throw new Error(`Transaction was not confirmed: ${transactionHash}`);
    return {
      transactionHash,
      blockNumber: receipt.blockNumber,
      success: receipt.status !== null && Number(receipt.status) === 1
    };
  }
}

/**
 * Client for an external signing service: the backend transmits the *unsigned*
 * payload over an authenticated channel; the service signs with a key this
 * process never holds, broadcasts, and reports the receipt.
 */
export class RemoteSigningServiceSigner implements RelayerSigner {
  constructor(
    readonly address: string,
    private readonly baseUrl: string,
    private readonly chainId: number,
    private readonly authToken?: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async send(transaction: RelayerTransaction): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/sign`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
        chainId: this.chainId
      })
    });
    if (!response.ok) throw new Error(`Signing service rejected the transaction: HTTP ${response.status}`);
    const body = (await response.json()) as { transactionHash?: string };
    if (!body.transactionHash) throw new Error("Signing service returned no transaction hash");
    return body.transactionHash;
  }

  async wait(transactionHash: string): Promise<RelayerReceipt> {
    const response = await this.fetchImpl(
      `${this.baseUrl.replace(/\/$/, "")}/receipt/${encodeURIComponent(transactionHash)}`,
      { headers: this.headers() }
    );
    if (!response.ok) throw new Error(`Signing service receipt lookup failed: HTTP ${response.status}`);
    const body = (await response.json()) as { blockNumber?: number; success?: boolean };
    if (typeof body.blockNumber !== "number" || typeof body.success !== "boolean") {
      throw new Error("Signing service returned an incomplete receipt");
    }
    return { transactionHash, blockNumber: body.blockNumber, success: body.success };
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.authToken) headers.authorization = `Bearer ${this.authToken}`;
    return headers;
  }
}
