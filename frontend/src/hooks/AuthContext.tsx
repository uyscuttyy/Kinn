/** Auth context — React state for wallet session, token, chain binding */

import { createContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { QueryClient } from '@tanstack/react-query';
import type { NetworkKey } from '@/types';
import { createApiClient } from '@/lib/api';

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
  login: (wallet: string) => Promise<void>;
  verify: (signature: string) => Promise<void>;
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
      setChainId(session.chainId);
      setExpiresAt(session.expiresAt);
    } catch {
      setToken(null);
      setWallet(null);
      setChainId(null);
      setExpiresAt(null);
    }
  }, [api, token]);

  const login = useCallback(
    async (walletAddress: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const { challenge } = await api.auth.challenge(walletAddress);
        sessionStorage.setItem('kinn_auth_challenge', JSON.stringify(challenge));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initiate authentication');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [api]
  );

  const verify = useCallback(
    async (signature: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const challengeStr = sessionStorage.getItem('kinn_auth_challenge');
        if (!challengeStr) throw new Error('No challenge found');
        const challenge = JSON.parse(challengeStr);
        const { token: newToken, expiresAt: newExpiresAt } = await api.auth.verify(challenge, signature);
        setToken(newToken);
        setExpiresAt(newExpiresAt);
        sessionStorage.removeItem('kinn_auth_challenge');
        await checkSession();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to verify signature');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [api, checkSession]
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
      login,
      verify,
      logout,
      checkSession,
    }),
    [token, wallet, chainId, expiresAt, isLoading, error, login, verify, logout, checkSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}