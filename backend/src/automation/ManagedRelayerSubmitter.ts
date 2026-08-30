import type { PreparedTransaction } from "../types.js";
import type { RelayerReceipt, RelayerSubmitter } from "./AutomationWorker.js";
import type { RelayerSignerProvider, RelayerTransaction } from "./RelayerSigner.js";

/**
 * The single submission path for the automation worker. Every submit goes
 * through the injected `RelayerSignerProvider`; no implementation detail (and
 * no key material) leaks into the worker.
 */
export class ManagedRelayerSubmitter implements RelayerSubmitter {
  constructor(private readonly signers: RelayerSignerProvider) {}

  async submit(deploymentKey: string, transaction: PreparedTransaction): Promise<string> {
    const request: RelayerTransaction = {
      to: transaction.to,
      data: transaction.data,
      value: transaction.value
    };
    return this.signers.get(deploymentKey).send(request);
  }

  async wait(deploymentKey: string, transactionHash: string): Promise<RelayerReceipt> {
    return this.signers.get(deploymentKey).wait(transactionHash);
  }
}
