/**
 * useSignTx — prepare → simulate → sign → broadcast → confirm.
 *
 * Primary signer is the first-party KeyManager (unlocked key): the prepared
 * tx is completed locally (nonce, gas, fees), signed offline, and broadcast
 * through the public RPC — the backend never sees key material and never
 * broadcasts. MetaMask/Rabby is the fallback when no Kinn key is unlocked.
 */

import { useMutation } from '@tanstack/react-query';
import { JsonRpcProvider } from 'ethers';
import type { NetworkKey, PreparedTransaction } from '@/types';
import { useExternalSigner } from './useExternalSigner';
import { useSimulateTransaction, useKeyManager } from './useApi';
import { parseRevertReason } from '@/utils/format';
import { NETWORKS } from '@/lib/config';

interface SignTxInput {
  prepared: PreparedTransaction;
  label?: string;
}

const RECEIPT_TIMEOUT_MS = 180_000;

export function useSignTx(networkKey: NetworkKey) {
  const { unlockedKeyId, signTransaction, getAddress } = useKeyManager();
  const external = useExternalSigner();
  const simulateMutation = useSimulateTransaction(networkKey);

  const mutation = useMutation({
    mutationFn: async ({ prepared, label }: SignTxInput) => {
      // 1. Simulate (early revert feedback; not confirmation).
      const simulated = await simulateMutation.mutateAsync({ prepared });
      if (!simulated.success) {
        throw new Error(
          `${label ? label + ': ' : ''}simulation reverted: ${parseRevertReason(simulated.revert || 'Unknown reason')}`
        );
      }

      const provider = new JsonRpcProvider(NETWORKS[networkKey].rpcUrl);

      // 2a. First-party path: complete, sign offline, broadcast.
      // The backend never sends `from`/nonce/gas, so the wallet fills them.
      if (unlockedKeyId) {
        const sender = await getAddress(unlockedKeyId);
        const [nonce, feeData] = await Promise.all([
          provider.getTransactionCount(sender, 'pending'),
          provider.getFeeData(),
        ]);
        let gasLimit: bigint;
        try {
          const estimate = await provider.estimateGas({
            to: prepared.to,
            data: prepared.data,
            value: prepared.value,
            from: sender,
          });
          gasLimit = (estimate * 120n) / 100n; // 20% headroom
        } catch {
          gasLimit = 300_000n;
        }
        const signed = await signTransaction(unlockedKeyId, {
          to: prepared.to,
          data: prepared.data,
          value: prepared.value,
          chainId: prepared.chainId,
          from: sender,
          nonce,
          gasLimit: gasLimit.toString(),
          maxFeePerGas: (feeData.maxFeePerGas ?? 2_000_000_000n).toString(),
          maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas ?? 1_000_000_000n).toString(),
          type: 2,
        });
        const sent = await provider.broadcastTransaction(signed);
        const receipt = await provider.waitForTransaction(sent.hash, 1, RECEIPT_TIMEOUT_MS);
        if (!receipt) throw new Error('Transaction sent but no receipt yet. Check the activity feed.');
        if (receipt.status !== 1) throw new Error(`Transaction reverted on-chain (${sent.hash}).`);
        return { hash: sent.hash };
      }

      // 2b. Fallback: external browser wallet signs + broadcasts.
      if (!external.connected) {
        throw new Error('Unlock your Kinn wallet or connect a browser wallet first.');
      }
      if (external.chainId && prepared.chainId && external.chainId !== prepared.chainId) {
        const w = window.ethereum;
        if (w) {
          try {
            await w.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: `0x${prepared.chainId.toString(16)}` }],
            });
          } catch {
            // ignore — let the user handle it
          }
        }
      }
      const hash = await external.sendTransaction(prepared);
      return { hash };
    },
  });

  return {
    ...mutation,
    signer: external,
    usingKeyManager: !!unlockedKeyId,
  };
}
