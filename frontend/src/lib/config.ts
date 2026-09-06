/** App config — chain + network constants */

import type { NetworkKey } from '@/types';

export interface NetworkConfig {
  key: NetworkKey;
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  factoryAddress: string;
  usdcAddress: string;
  isTestnet: boolean;
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  'base-sepolia': {
    key: 'base-sepolia',
    name: 'Base Sepolia',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    factoryAddress: '0x672778401F0F550284347Bf32aB883B4a2A72933',
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    isTestnet: true,
  },
  base: {
    key: 'base',
    name: 'Base',
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    factoryAddress: '',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    isTestnet: false,
  },
};

export const DEFAULT_NETWORK: NetworkKey = 'base-sepolia';

/** ETH sentinel address (used by contract for native ETH in asset lists) */
export const ETH_SENTINEL = '0x0000000000000000000000000000000000000001';

export const SUPPORTED_CHAIN_ID = NETWORKS[DEFAULT_NETWORK].chainId;
export const EXPLORER_TX_BASE = `${NETWORKS[DEFAULT_NETWORK].explorerUrl}/tx`;