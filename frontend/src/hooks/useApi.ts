/** React hooks for data fetching, mutations, and wallet (KeyManager) */

import { useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import type {
  NetworkKey,
  PreparedTransaction,
  CreateVaultRequest,
  UpdateBeneficiariesRequest,
  UpdateSettingsRequest,
  DepositRequest,
  KeyHandle,
  GeneratedKey,
  SignableTransaction,
} from '@/types';
import { createApiClient } from '@/lib/api';
import { parseRevertReason } from '@/utils/format';
import { queryClient, AuthContext, type AuthState } from './AuthContext';

export { queryClient };

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

// ============================================================================
// API Hooks
// ============================================================================

export function useApi(networkKey: NetworkKey) {
  const { token } = useAuth();
  return useMemo(() => createApiClient(networkKey, () => token), [networkKey, token]);
}

export function useVaultStatus(owner: string | null, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useQuery({
    queryKey: ['vaultStatus', networkKey, owner],
    queryFn: () => (owner ? api.vault.getStatus(owner) : null),
    enabled: !!owner,
    refetchInterval: 10_000,
  });
}

export function useVaultActivity(owner: string | null, networkKey: NetworkKey, limit = 50) {
  const api = useApi(networkKey);
  return useQuery({
    queryKey: ['vaultActivity', networkKey, owner, limit],
    queryFn: () => (owner ? api.vault.getActivity(owner, { limit }) : { events: [], nextCursor: undefined }),
    enabled: !!owner,
  });
}

export function useBeneficiaries(owner: string | null, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useQuery({
    queryKey: ['beneficiaries', networkKey, owner],
    queryFn: () => (owner ? api.vault.getBeneficiaries(owner) : null),
    enabled: !!owner,
  });
}

export function useInheritanceInfo(owner: string | null, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useQuery({
    queryKey: ['inheritance', networkKey, owner],
    queryFn: () => (owner ? api.vault.getInheritance(owner) : null),
    enabled: !!owner,
    refetchInterval: 10_000,
  });
}

export function useDistributionInfo(owner: string | null, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useQuery({
    queryKey: ['distribution', networkKey, owner],
    queryFn: () => (owner ? api.vault.getDistribution(owner) : null),
    enabled: !!owner,
    refetchInterval: 10_000,
  });
}

export function useWalletBalances(networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useQuery({
    queryKey: ['walletBalances', networkKey],
    queryFn: () => api.wallet.getBalances(),
    refetchInterval: 15_000,
  });
}

export function useAssets(networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useQuery({
    queryKey: ['assets', networkKey],
    queryFn: () => api.assets.get(),
    staleTime: 5 * 60_000,
  });
}

// Mutations
export function useCreateVault(networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: (request: CreateVaultRequest) => api.vault.create(request),
  });
}

export function useCheckIn(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: () => api.vault.checkIn(owner),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vaultStatus', networkKey, owner] });
      queryClient.invalidateQueries({ queryKey: ['inheritance', networkKey, owner] });
    },
  });
}

export function useUpdateBeneficiaries(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: (request: UpdateBeneficiariesRequest) => api.vault.updateBeneficiaries(owner, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['beneficiaries', networkKey, owner] });
      queryClient.invalidateQueries({ queryKey: ['vaultStatus', networkKey, owner] });
    },
  });
}

export function useRemoveBeneficiaries(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: () => api.vault.removeBeneficiaries(owner),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['beneficiaries', networkKey, owner] });
      queryClient.invalidateQueries({ queryKey: ['vaultStatus', networkKey, owner] });
    },
  });
}

export function useUpdateSettings(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: (request: UpdateSettingsRequest) => api.vault.updateSettings(owner, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vaultStatus', networkKey, owner] });
      queryClient.invalidateQueries({ queryKey: ['inheritance', networkKey, owner] });
    },
  });
}

export function useTopUpReserve(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: (amount: string) => api.vault.topUpReserve(owner, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vaultStatus', networkKey, owner] });
    },
  });
}

export function useWithdrawReserve(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: (amount: string) => api.vault.withdrawReserve(owner, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vaultStatus', networkKey, owner] });
    },
  });
}

export function useApproveToken(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: ({ token, amount }: { token: string; amount: string }) => api.vault.approveToken(owner, token, amount),
  });
}

export function useDeposit(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: (request: DepositRequest) => api.vault.deposit(owner, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vaultStatus', networkKey, owner] });
      queryClient.invalidateQueries({ queryKey: ['walletBalances', networkKey] });
    },
  });
}

export function useWithdraw(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: (request: DepositRequest) => api.vault.withdraw(owner, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vaultStatus', networkKey, owner] });
      queryClient.invalidateQueries({ queryKey: ['walletBalances', networkKey] });
    },
  });
}

export function useCloseVault(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: () => api.vault.close(owner),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vaultStatus', networkKey, owner] });
    },
  });
}

export function useSimulateTransaction(networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: ({ prepared, stateOverride }: { prepared: PreparedTransaction; stateOverride?: Record<string, unknown> }) =>
      api.transactions.simulate(prepared, stateOverride),
  });
}

export function useSubmitTransaction(networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: (rawSignedTransaction: string) => api.transactions.submit(rawSignedTransaction),
  });
}

export function useTransactionStatus(hash: string | null, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useQuery({
    queryKey: ['txStatus', networkKey, hash],
    queryFn: () => (hash ? api.transactions.getStatus(hash) : null),
    enabled: !!hash,
    refetchInterval: (query) => {
      const data = query.state.data;
      const status = data?.status;
      if (status === 'pending') return 5_000;
      return false;
    },
  });
}

// ============================================================================
// KeyManager Hook (First-party wallet)
// The real KeyManager is bundled from backend/wallet-client/keymanager.
// This is a browser placeholder; the real implementation would be loaded
// via dynamic import in production.
// ============================================================================

interface KeyManagerInstance {
  generate: (passphrase: string, label?: string) => Promise<GeneratedKey>;
  getAddress: (id: string) => Promise<string>;
  signMessage: (id: string, message: string) => Promise<string>;
  signTransaction: (id: string, tx: SignableTransaction) => Promise<string>;
  destroy: (id: string) => Promise<void>;
  has: (id: string) => Promise<boolean>;
  list: () => Promise<KeyHandle[]>;
  unlock: (id: string, passphrase: string) => Promise<void>;
  lock: (id: string) => void;
  lockAll: () => void;
  isUnlocked: (id: string) => boolean;
}

function createPlaceholderKeyManager(): KeyManagerInstance {
  const notAvailable = (_msg?: string) =>
    Promise.reject(
      new Error('First-party KeyManager not bundled. Use MetaMask/WalletConnect for now.')
    );
  return {
    generate: (p, l) => notAvailable(`generate(${p.length}, ${l})`),
    getAddress: (id) => notAvailable(`getAddress(${id})`),
    signMessage: (id, m) => notAvailable(`signMessage(${id}, ${m.length})`),
    signTransaction: (id, t) => notAvailable(`signTransaction(${id}, ${JSON.stringify(t).length})`),
    destroy: (id) => notAvailable(`destroy(${id})`),
    has: async () => false,
    list: async () => [],
    unlock: (id, p) => notAvailable(`unlock(${id}, ${p.length})`),
    lock: () => {},
    lockAll: () => {},
    isUnlocked: () => false,
  };
}

export function useKeyManager() {
  const [keys, setKeys] = useState<KeyHandle[]>([]);
  const [unlockedKeyId, setUnlockedKeyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kmRef = useRef<KeyManagerInstance | null>(null);

  useEffect(() => {
    const km = createPlaceholderKeyManager();
    kmRef.current = km;
    km.list().then(setKeys).catch(() => {});
  }, []);

  const generate = useCallback(
    async (passphrase: string, label?: string) => {
      const km = kmRef.current;
      if (!km) throw new Error('KeyManager not initialized');
      setIsLoading(true);
      setError(null);
      try {
        const generated = await km.generate(passphrase, label);
        setKeys((prev) => [...prev, generated]);
        return generated;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate key');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const unlock = useCallback(
    async (id: string, passphrase: string) => {
      const km = kmRef.current;
      if (!km) throw new Error('KeyManager not initialized');
      setIsLoading(true);
      setError(null);
      try {
        await km.unlock(id, passphrase);
        setUnlockedKeyId(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to unlock key');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const lock = useCallback(
    (id: string) => {
      const km = kmRef.current;
      if (!km) return;
      km.lock(id);
      if (unlockedKeyId === id) setUnlockedKeyId(null);
    },
    [unlockedKeyId]
  );

  const lockAll = useCallback(() => {
    const km = kmRef.current;
    if (!km) return;
    km.lockAll();
    setUnlockedKeyId(null);
  }, []);

  const signTransaction = useCallback(
    async (id: string, tx: SignableTransaction) => {
      const km = kmRef.current;
      if (!km) throw new Error('KeyManager not initialized');
      if (!km.isUnlocked(id)) throw new Error('Key is locked');
      return km.signTransaction(id, tx);
    },
    []
  );

  const signMessage = useCallback(
    async (id: string, message: string) => {
      const km = kmRef.current;
      if (!km) throw new Error('KeyManager not initialized');
      if (!km.isUnlocked(id)) throw new Error('Key is locked');
      return km.signMessage(id, message);
    },
    []
  );

  const getAddress = useCallback(
    async (id: string) => {
      const km = kmRef.current;
      if (!km) throw new Error('KeyManager not initialized');
      return km.getAddress(id);
    },
    []
  );

  const destroy = useCallback(
    async (id: string) => {
      const km = kmRef.current;
      if (!km) throw new Error('KeyManager not initialized');
      await km.destroy(id);
      setKeys((prev) => prev.filter((k) => k.id !== id));
      if (unlockedKeyId === id) setUnlockedKeyId(null);
    },
    [unlockedKeyId]
  );

  return {
    keys,
    unlockedKeyId,
    isLoading,
    error,
    generate,
    unlock,
    lock,
    lockAll,
    signTransaction,
    signMessage,
    getAddress,
    destroy,
    isUnlocked: (id: string) => unlockedKeyId === id,
  };
}

// ============================================================================
// Signing Flow Hook (prepare → simulate → sign → broadcast → verify)
// ============================================================================

export function useSignAndBroadcast(networkKey: NetworkKey) {
  const { signTransaction } = useKeyManager();
  const simulateMutation = useSimulateTransaction(networkKey);
  const submitMutation = useSubmitTransaction(networkKey);

  const signAndBroadcast = useCallback(
    async ({
      prepared,
      keyId,
      onSuccess,
      onError,
    }: {
      prepared: PreparedTransaction;
      keyId: string;
      onSuccess?: (hash: string) => void;
      onError?: (error: Error) => void;
    }) => {
      try {
        const simulated = await simulateMutation.mutateAsync({ prepared });
        if (!simulated.success) {
          throw new Error(`Simulation failed: ${parseRevertReason(simulated.revert || 'Unknown error')}`);
        }

        const signedTx = await signTransaction(keyId, prepared);
        const { hash } = await submitMutation.mutateAsync(signedTx);
        onSuccess?.(hash);
        return hash;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        throw error;
      }
    },
    [signTransaction, simulateMutation, submitMutation]
  );

  return {
    signAndBroadcast,
    isSimulating: simulateMutation.isPending,
    isSubmitting: submitMutation.isPending,
    isPending: simulateMutation.isPending || submitMutation.isPending,
    error: simulateMutation.error || submitMutation.error,
  };
}