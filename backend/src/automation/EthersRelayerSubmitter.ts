import type { Signer } from "ethers";
import type { PreparedTransaction } from "../types.js";
import type { RelayerReceipt, RelayerSubmitter } from "./AutomationWorker.js";

export class EthersRelayerSubmitter implements RelayerSubmitter {
  constructor(private readonly signers: ReadonlyMap<string, Signer>) {}

  async submit(deploymentKey: string, transaction: PreparedTransaction): Promise<string> {
    const signer = this.signer(deploymentKey);
    const network = await signer.provider?.getNetwork();
    if (!network) throw new Error(`Relayer signer has no provider: ${deploymentKey}`);
    if (network.chainId !== BigInt(transaction.chainId)) throw new Error("Relayer chain ID mismatch");
    const response = await signer.sendTransaction({
      to: transaction.to,
      data: transaction.data,
      value: BigInt(transaction.value)
    });
    return response.hash;
  }

  async wait(deploymentKey: string, transactionHash: string): Promise<RelayerReceipt> {
    const provider = this.signer(deploymentKey).provider;
    if (!provider) throw new Error(`Relayer signer has no provider: ${deploymentKey}`);
    const receipt = await provider.waitForTransaction(transactionHash);
    if (!receipt) throw new Error(`Transaction was not confirmed: ${transactionHash}`);
    return {
      transactionHash,
      blockNumber: receipt.blockNumber,
      success: receipt.status === 1
    };
  }

  private signer(deploymentKey: string): Signer {
    const signer = this.signers.get(deploymentKey);
    if (!signer) throw new Error(`No relayer signer configured for deployment: ${deploymentKey}`);
    return signer;
  }
}
