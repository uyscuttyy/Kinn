/** Auth context — wallet session, token, challenge/verify */

import { createContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { QueryClient } from '@tanstack/react-query';
import type { NetworkKey } from '@/types';
import { createApiClient } from '@/lib/api';
import { NETWORKS } from '@/lib/config';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: 60_000,
      refetchOnWindowFocus: true,
      refetchInterval: 15_000,
      retry: 1,
    },
  },
});

export interface AuthState {
  token: string | null;
  wallet: string | null;
  chainId: number | null;
  expiresAt: number | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  /** Step 1: get a challenge from the backend, store it, return the message that must be signed. */
  startChallenge: (wallet: string) => Promise<{ message: unknown; domain: unknown; types: unknown; primaryType: string }>;
  /** Step 2: submit the signature, get a session token, populate state. */
  completeChallenge: (signature: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  networkKey: NetworkKey;
}

export function AuthProvider({ children, networkKey }: AuthProviderProps) {
  const [token, setToken] = useState<string | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api = useMemo(() => createApiClient(networkKey, () => token), [networkKey, token]);

  const checkSession = useCallback(async () => {
    if (!token) return;
    try {
      const session = await api.auth.session(token);
      setWallet(session.wallet);
      setChainId(NETWORKS[networkKey].chainId);
      setExpiresAt(session.expiresAt);
    } catch {
      setToken(null);
      setWallet(null);
      setChainId(null);
      setExpiresAt(null);
    }
  }, [api, token, networkKey]);

  const startChallenge = useCallback(
    async (walletAddress: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const { challenge } = await api.auth.challenge(walletAddress);
        sessionStorage.setItem('kinn_auth_challenge', JSON.stringify(challenge));
        return {
          message: challenge.message,
          domain: challenge.domain,
          types: challenge.types,
          primaryType: challenge.primaryType,
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initiate authentication');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [api]
  );

  const completeChallenge = useCallback(
    async (signature: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const challengeStr = sessionStorage.getItem('kinn_auth_challenge');
        if (!challengeStr) throw new Error('No challenge found');
        const challenge = JSON.parse(challengeStr) as { message?: { wallet?: string; nonce?: string } };
        const nonce = challenge.message?.nonce;
        if (!nonce) throw new Error('Challenge has no nonce');
        const { token: newToken, expiresAt: newExpiresAt } = await api.auth.verify(nonce, signature);
        setToken(newToken);
        setExpiresAt(newExpiresAt);
        // The wallet address comes from the challenge message (it binds the wallet)
        const walletFromChallenge = challenge.message?.wallet;
        if (walletFromChallenge) setWallet(walletFromChallenge);
        setChainId(NETWORKS[networkKey].chainId);
        sessionStorage.removeItem('kinn_auth_challenge');
        await checkSession();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to verify signature');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [api, checkSession, networkKey]
  );

  const logout = useCallback(async () => {
    if (token) {
      try {
        await api.auth.logout(token);
      } catch {
        // ignore
      }
    }
    setToken(null);
    setWallet(null);
    setChainId(null);
    setExpiresAt(null);
    queryClient.clear();
  }, [api, token]);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const value = useMemo(
    () => ({
      token,
      wallet,
      chainId,
      expiresAt,
      isAuthenticated: !!token && !!wallet,
      isLoading,
      error,
      startChallenge,
      completeChallenge,
      logout,
      checkSession,
    }),
    [token, wallet, chainId, expiresAt, isLoading, error, startChallenge, completeChallenge, logout, checkSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}