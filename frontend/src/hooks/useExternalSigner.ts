/** External signer — wraps window.ethereum (MetaMask, Rabby, etc.) for EIP-191 / EIP-712 / eth_sendTransaction */

import { useCallback, useEffect, useState } from 'react';
import type { Eip1193Provider, SignableTransaction } from '@/types';

export type ExternalSignerKind = 'metamask' | 'rabby' | 'injected' | 'none';

export interface ExternalSignerState {
  available: boolean;
  connected: boolean;
  address: string | null;
  chainId: number | null;
  kind: ExternalSignerKind;
  error: string | null;
  isConnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signMessage: (message: string) => Promise<string>;
  signTypedData: (typedData: { domain: unknown; types: unknown; primaryType: string; message: unknown }) => Promise<string>;
  sendTransaction: (tx: SignableTransaction) => Promise<string>; // returns tx hash
}

function detectProvider(): { provider: Eip1193Provider; kind: ExternalSignerKind } | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { ethereum?: Eip1193Provider & { isMetaMask?: boolean; isRabby?: boolean } };
  if (!w.ethereum) return null;
  if (w.ethereum.isRabby) return { provider: w.ethereum, kind: 'rabby' };
  if (w.ethereum.isMetaMask) return { provider: w.ethereum, kind: 'metamask' };
  return { provider: w.ethereum, kind: 'injected' };
}

const ETH_SENTINEL = '0x0000000000000000000000000000000000000001';

function preparedToEip1193(tx: SignableTransaction): {
  from: string;
  to: string;
  data: string;
  value: string;
  gas?: string;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
} {
  // Backend may return value as decimal string (wei); ethereum provider expects 0x hex
  const toHex = (v: string | number | undefined): string => {
    if (v === undefined || v === null || v === '') return '0x0';
    if (typeof v === 'string' && v.startsWith('0x')) return v;
    // decimal wei -> hex
    const big = BigInt(v);
    return '0x' + big.toString(16);
  };

  return {
    from: tx.from ?? '',
    to: tx.to ?? ETH_SENTINEL,
    data: tx.data ?? '0x',
    value: toHex(tx.value),
    gas: tx.gasLimit ? toHex(tx.gasLimit) : undefined,
    gasLimit: tx.gasLimit ? toHex(tx.gasLimit) : undefined,
    maxFeePerGas: tx.maxFeePerGas ? toHex(tx.maxFeePerGas) : undefined,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? toHex(tx.maxPriorityFeePerGas) : undefined,
  };
}

export function useExternalSigner(): ExternalSignerState {
  const [available, setAvailable] = useState(false);
  const [kind, setKind] = useState<ExternalSignerKind>('none');
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);

  // Detect provider on mount
  useEffect(() => {
    const detected = detectProvider();
    if (detected) {
      setAvailable(true);
      setKind(detected.kind);
      setProvider(detected.provider);
    } else {
      setAvailable(false);
      setKind('none');
    }
  }, []);

  // Listen for account/chain changes
  useEffect(() => {
    if (!provider || !provider.on) return;
    const handleAccountsChanged = (accounts: unknown) => {
      const accs = accounts as string[];
      if (!accs || accs.length === 0) {
        setAddress(null);
        setError('Wallet disconnected');
      } else {
        setAddress(accs[0]);
        setError(null);
      }
    };
    const handleChainChanged = (cid: unknown) => {
      const c = typeof cid === 'string' ? parseInt(cid, 16) : (cid as number);
      setChainId(c);
    };
    const handleDisconnect = () => {
      setAddress(null);
      setError('Wallet disconnected');
    };
    provider.on('accountsChanged', handleAccountsChanged);
    provider.on('chainChanged', handleChainChanged);
    provider.on('disconnect', handleDisconnect);
    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
      provider.removeListener?.('chainChanged', handleChainChanged);
      provider.removeListener?.('disconnect', handleDisconnect);
    };
  }, [provider]);

  const connect = useCallback(async () => {
    if (!provider) {
      setError('No browser wallet detected. Install MetaMask or use Rabby.');
      throw new Error('No browser wallet detected');
    }
    setIsConnecting(true);
    setError(null);
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      if (!accounts || accounts.length === 0) throw new Error('No account returned');
      setAddress(accounts[0]);
      const cid = (await provider.request({ method: 'eth_chainId' })) as string;
      setChainId(parseInt(cid, 16));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, [provider]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setChainId(null);
    setError(null);
  }, []);

  const signMessage = useCallback(
    async (message: string): Promise<string> => {
      if (!provider || !address) throw new Error('Wallet not connected');
      // eth_personalSign expects [from, message]
      const sig = (await provider.request({
        method: 'personal_sign',
        params: [address, message],
      })) as string;
      return sig;
    },
    [provider, address]
  );

  const signTypedData = useCallback(
    async (typedData: { domain: unknown; types: unknown; primaryType: string; message: unknown }): Promise<string> => {
      if (!provider || !address) throw new Error('Wallet not connected');
      // eth_signTypedData_v4 expects [from, JSON-string]
      const sig = (await provider.request({
        method: 'eth_signTypedData_v4',
        params: [address, JSON.stringify(typedData)],
      })) as string;
      return sig;
    },
    [provider, address]
  );

  const sendTransaction = useCallback(
    async (tx: SignableTransaction): Promise<string> => {
      if (!provider || !address) throw new Error('Wallet not connected');
      const eip1193Tx = preparedToEip1193(tx);
      const hash = (await provider.request({
        method: 'eth_sendTransaction',
        params: [eip1193Tx],
      })) as string;
      return hash;
    },
    [provider, address]
  );

  return {
    available,
    connected: !!address,
    address,
    chainId,
    kind,
    error,
    isConnecting,
    connect,
    disconnect,
    signMessage,
    signTypedData,
    sendTransaction,
  };
}