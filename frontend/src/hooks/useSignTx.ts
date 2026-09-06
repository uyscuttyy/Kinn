/** useSignTx — wraps prepare → simulate → sign+send via the external signer.
 *  Each prepare-mutation accepts a single PreparedTransaction; the hook composes
 *  the full flow and returns a hash on success. */

import { useMutation } from '@tanstack/react-query';
import type { NetworkKey, PreparedTransaction } from '@/types';
import { useExternalSigner } from './useExternalSigner';
import { useSimulateTransaction } from './useApi';

interface SignTxInput {
  prepared: PreparedTransaction;
  label?: string;
}

export function useSignTx(networkKey: NetworkKey) {
  const signer = useExternalSigner();
  const simulateMutation = useSimulateTransaction(networkKey);

  const mutation = useMutation({
    mutationFn: async ({ prepared, label }: SignTxInput) => {
      if (!signer.connected) {
        throw new Error('Connect your browser wallet first');
      }

      // 1. Simulate
      const simulated = await simulateMutation.mutateAsync({ prepared });
      if (!simulated.success) {
        throw new Error(`Simulation reverted: ${simulated.revert || 'Unknown reason'}`);
      }

      // 2. Switch chain if needed
      if (signer.chainId && prepared.chainId && signer.chainId !== prepared.chainId) {
        const w = (window as Window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
        if (w) {
          try {
            await w.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: `0x${prepared.chainId.toString(16)}` }],
            });
          } catch {
            // ignore
          }
        }
      }

      // 3. Send tx via external wallet
      const hash = await signer.sendTransaction(prepared);
      return { hash, label };
    },
  });

  return { ...mutation, signer };
}