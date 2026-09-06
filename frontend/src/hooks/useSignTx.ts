/**
 * useSignTx — prepare → simulate → sign → broadcast → confirm.
 *
 * The ONLY signer is the first-party KeyManager (unlocked key): the prepared
 * tx is completed locally (nonce, gas, fees), signed offline, and broadcast
 * through the public RPC. The backend never sees key material and never
 * broadcasts. If no Kinn key is unlocked, the user is told to unlock first.
 */

import { useMutation } from '@tanstack/react-query';
import { JsonRpcProvider } from 'ethers';
import type { NetworkKey, PreparedTransaction } from '@/types';
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

      // 2. First-party signing. The backend never sends `from`/nonce/gas,
      // so the wallet fills them from the unlocked key and live chain state.
      if (!unlockedKeyId) {
        throw new Error('Unlock your Kinn wallet first.');
      }
      const provider = new JsonRpcProvider(NETWORKS[networkKey].rpcUrl);
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

      // 3. Broadcast + confirm. Only a mined receipt counts as done.
      const sent = await provider.broadcastTransaction(signed);
      const receipt = await provider.waitForTransaction(sent.hash, 1, RECEIPT_TIMEOUT_MS);
      if (!receipt) throw new Error('Transaction sent but no receipt yet. Check the activity feed.');
      if (receipt.status !== 1) throw new Error(`Transaction reverted on-chain (${sent.hash}).`);
      return { hash: sent.hash };
    },
  });

  return { ...mutation, usingKeyManager: true as const };
}
