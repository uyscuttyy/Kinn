/**
 * React hooks: auth session, chain reads, owner writes, KeyManager wallet.
 *
 * Write paths with no dedicated backend endpoint (settings, reserve,
 * approve, deposit, withdraw) are encoded client-side via lib/contract.ts
 * and sent through POST /transactions/prepare. The KeyManager signs; the
 * frontend broadcasts via an ethers provider (the backend never broadcasts).
 */

import { useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { JsonRpcProvider } from 'ethers';
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
  TransactionStatus,
} from '@/types';
import { createApiClient, ApiClientError } from '@/lib/api';
import { contractWrites, ETH_SENTINEL } from '@/lib/contract';
import { NETWORKS } from '@/lib/config';
import { LocalEncryptedKeyManager } from '@/lib/keymanager/LocalEncryptedKeyManager';
import type { TypedDataDomain, TypedDataField } from 'ethers';
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
    queryFn: async () => {
      if (!owner) return null;
      try {
        return await api.vault.getStatus(owner);
      } catch (err) {
        if (err instanceof ApiClientError && err.isNoVault) return null;
        throw err;
      }
    },
    enabled: !!owner,
    refetchInterval: 10_000,
  });
}

export function useVaultActivity(owner: string | null, networkKey: NetworkKey, limit = 50) {
  const api = useApi(networkKey);
  return useQuery({
    queryKey: ['vaultActivity', networkKey, owner, limit],
    queryFn: () => (owner ? api.vault.getActivity(owner) : { events: [] }),
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

// Mutations — endpoint-backed writes
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

export function useCloseVault(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: () => api.vault.close(owner),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vaultStatus', networkKey, owner] });
    },
  });
}

// Mutations — client-encoded writes (no dedicated endpoint; via /transactions/prepare)
async function resolveVault(api: ReturnType<typeof createApiClient>, owner: string): Promise<string> {
  const status = await api.vault.getStatus(owner);
  return status.vaultAddress;
}

export function useUpdateSettings(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: async (request: UpdateSettingsRequest) => {
      const status = await api.vault.getStatus(owner);
      const interval = request.checkInInterval ?? parseInt(status.checkInInterval, 10);
      const misses = request.maxMissedCheckIns ?? status.maxMissedCheckIns;
      const prepared = await contractWrites.updateSettings(api, status.vaultAddress, interval, misses, owner);
      return { prepared };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vaultStatus', networkKey, owner] });
      queryClient.invalidateQueries({ queryKey: ['inheritance', networkKey, owner] });
    },
  });
}

export function useTopUpReserve(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: async (amount: string) => {
      const vault = await resolveVault(api, owner);
      const prepared = await contractWrites.topUpReserve(api, vault, amount, owner);
      return { prepared };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vaultStatus', networkKey, owner] });
    },
  });
}

export function useWithdrawReserve(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: async (amount: string) => {
      const vault = await resolveVault(api, owner);
      const prepared = await contractWrites.withdrawReserve(api, vault, amount, owner);
      return { prepared };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vaultStatus', networkKey, owner] });
    },
  });
}

export function useApproveToken(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: async ({ token, amount }: { token: string; amount: string }) => {
      const vault = await resolveVault(api, owner);
      const prepared = await contractWrites.approveToken(api, token, vault, amount, owner);
      return { prepared };
    },
  });
}

function isNativeAsset(asset: string): boolean {
  return asset.toLowerCase() === ETH_SENTINEL.toLowerCase();
}

export function useDeposit(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: async (request: DepositRequest) => {
      const vault = await resolveVault(api, owner);
      const prepared = isNativeAsset(request.asset)
        ? await contractWrites.depositETH(api, vault, request.amount, owner)
        : await contractWrites.depositToken(api, vault, request.asset, request.amount, owner);
      return { prepared };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vaultStatus', networkKey, owner] });
      queryClient.invalidateQueries({ queryKey: ['walletBalances', networkKey] });
    },
  });
}

export function useWithdraw(owner: string, networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: async (request: DepositRequest) => {
      const vault = await resolveVault(api, owner);
      const prepared = await contractWrites.withdraw(api, vault, request.asset, request.amount, owner);
      return { prepared };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vaultStatus', networkKey, owner] });
      queryClient.invalidateQueries({ queryKey: ['walletBalances', networkKey] });
    },
  });
}

export function useSimulateTransaction(networkKey: NetworkKey) {
  const api = useApi(networkKey);
  return useMutation({
    mutationFn: ({ prepared }: { prepared: PreparedTransaction }) =>
      api.transactions.simulate(prepared),
  });
}

/** Receipt polling via the public RPC (the backend never reports tx status). */
export function useTransactionStatus(hash: string | null, networkKey: NetworkKey) {
  const rpcUrl = NETWORKS[networkKey].rpcUrl;
  return useQuery({
    queryKey: ['txStatus', networkKey, hash],
    queryFn: async (): Promise<TransactionStatus | null> => {
      if (!hash) return null;
      const provider = new JsonRpcProvider(rpcUrl);
      const receipt = await provider.getTransactionReceipt(hash);
      if (!receipt) return { hash, status: 'pending' };
      const ok = receipt.status === 1;
      return {
        hash,
        status: ok ? 'confirmed' : 'failed',
        blockNumber: receipt.blockNumber,
        receipt: { status: receipt.status ?? 0, gasUsed: receipt.gasUsed.toString() },
      };
    },
    enabled: !!hash,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === 'pending' ? 5_000 : false;
    },
  });
}

// ============================================================================
// KeyManager Hook (first-party Kinn wallet)
// One shared LocalEncryptedKeyManager (localStorage-backed); unlock state is
// shared across hook instances via a module-level store. Keys lock on tab hide.
// ============================================================================

let kmSingleton: LocalEncryptedKeyManager | null = null;
let kmInitError: string | null = null;
let unlockedIdStore: string | null = null;
const unlockedListeners = new Set<(id: string | null) => void>();
let lockHookInstalled = false;

function getKm(): LocalEncryptedKeyManager {
  if (!kmSingleton) {
    if (kmInitError) throw new Error(kmInitError);
    try {
      kmSingleton = new LocalEncryptedKeyManager();
    } catch (err) {
      kmInitError = err instanceof Error ? err.message : 'KeyManager unavailable';
      throw new Error(kmInitError);
    }
  }
  return kmSingleton;
}

function setUnlockedStore(id: string | null) {
  unlockedIdStore = id;
  unlockedListeners.forEach((l) => l(id));
}

function installLockHook() {
  if (lockHookInstalled || typeof window === 'undefined') return;
  lockHookInstalled = true;
  const lock = () => {
    try {
      kmSingleton?.lockAll();
    } catch {
      // ignore
    }
    setUnlockedStore(null);
  };
  window.addEventListener('pagehide', lock);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') lock();
  });
}

export function useKeyManager() {
  const [keys, setKeys] = useState<KeyHandle[]>([]);
  const [unlockedKeyId, setUnlockedKeyId] = useState<string | null>(unlockedIdStore);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kmRef = useRef<LocalEncryptedKeyManager | null>(null);

  useEffect(() => {
    installLockHook();
    try {
      kmRef.current = getKm();
      getKm()
        .list()
        .then(setKeys)
        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to list keys'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'KeyManager unavailable');
    }
    const listener = (id: string | null) => setUnlockedKeyId(id);
    unlockedListeners.add(listener);
    return () => {
      unlockedListeners.delete(listener);
    };
  }, []);

  const refreshKeys = useCallback(async () => {
    try {
      setKeys(await getKm().list());
    } catch {
      // keep stale list
    }
  }, []);

  const generate = useCallback(
    async (passphrase: string, label?: string): Promise<GeneratedKey> => {
      setIsLoading(true);
      setError(null);
      try {
        const generated = await getKm().generate(passphrase, label);
        // The fresh passphrase is known: unlock immediately for this session.
        await getKm().unlock(generated.id, passphrase);
        setUnlockedStore(generated.id);
        await refreshKeys();
        return generated;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate key');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [refreshKeys]
  );

  const unlock = useCallback(async (id: string, passphrase: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await getKm().unlock(id, passphrase);
      setUnlockedStore(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock key');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const lock = useCallback(
    (id: string) => {
      try {
        getKm().lock(id);
      } catch {
        // ignore
      }
      if (unlockedIdStore === id) setUnlockedStore(null);
    },
    []
  );

  const lockAll = useCallback(() => {
    try {
      getKm().lockAll();
    } catch {
      // ignore
    }
    setUnlockedStore(null);
  }, []);

  const signTransaction = useCallback(async (id: string, tx: SignableTransaction) => {
    const km = kmRef.current ?? getKm();
    if (!km.isUnlocked(id)) throw new Error('Key is locked');
    return km.signTransaction(id, tx);
  }, []);

  const signMessage = useCallback(async (id: string, message: string) => {
    const km = kmRef.current ?? getKm();
    if (!km.isUnlocked(id)) throw new Error('Key is locked');
    return km.signMessage(id, message);
  }, []);

  const signTypedData = useCallback(
    async (
      id: string,
      domain: TypedDataDomain,
      types: Record<string, TypedDataField[]>,
      primaryType: string,
      message: Record<string, unknown>
    ) => {
      const km = kmRef.current ?? getKm();
      if (!km.isUnlocked(id)) throw new Error('Key is locked');
      return km.signTypedData(id, domain, types, primaryType, message);
    },
    []
  );

  const getAddress = useCallback(async (id: string) => getKm().getAddress(id), []);

  const destroy = useCallback(async (id: string) => {
    await getKm().destroy(id);
    if (unlockedIdStore === id) setUnlockedStore(null);
    await refreshKeys();
  }, [refreshKeys]);

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
    signTypedData,
    getAddress,
    destroy,
    refreshKeys,
    isUnlocked: (id: string) => unlockedKeyId === id,
  };
}
