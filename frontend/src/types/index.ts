/** Kinn Frontend Types — normalized views over the real backend shapes.
 * Raw backend responses are adapted in lib/api.ts; pages and hooks only
 * ever see the normalized types below. */

export type NetworkKey = 'base-sepolia' | 'base';

export type InheritanceState =
  | 'Active'
  | 'Missed'
  | 'Eligible'
  | 'Distributing'
  | 'Distributed'
  | 'Closed';

export interface Asset {
  symbol: string;
  address: string;
  decimals: number;
  native: boolean;
}

/** Unsigned transaction as returned by the backend (hex value, no nonce/gas). */
export interface PreparedTransaction {
  chainId: number;
  to: string;
  data: string;
  value: string;
  from?: string;
}

/** Normalized vault view (state is derived client-side from chain flags). */
export interface VaultStatus {
  owner: string;
  vaultAddress: string;
  state: InheritanceState;
  lastCheckIn: string;        // unix timestamp (seconds)
  checkInInterval: string;    // seconds
  maxMissedCheckIns: number;
  reserve: string;            // wei
  balances: Record<string, string>; // token address -> balance (wei)
  active: boolean;
  inheritanceTriggered: boolean;
  missedCheckIns: number;
  inheritanceEligible: boolean;
  eligibilityDeadline: string; // lastCheckIn + interval * maxMissed
  nextExpectedCheckIn: string;
}

export interface VaultActivityEvent {
  type: string;
  /** 0 when the backend has no timestamp (indexed events carry block numbers). */
  timestamp: number;
  txHash: string;
  blockNumber: number;
  data: Record<string, unknown>;
}

export interface Beneficiary {
  account: string;
  allocationBps: number;
  label?: string;
}

export interface BeneficiariesResponse {
  beneficiaries: Beneficiary[];
  totalAllocationBps: number;
}

export interface InheritanceInfo {
  eligibilityDeadline: string;    // unix timestamp (seconds)
  missedCheckIns: number;
  maxMissedCheckIns: number;
  inheritanceEligible: boolean;
}

/** Raw backend distribution view: per-asset remaining balances. */
export interface DistributionInfo {
  assets: Array<{ asset: string; balance: string }>;
}

export interface PendingEntitlement {
  beneficiary: string;
  amount: string;
  nextRetryAt: string; // unix timestamp (seconds)
}

export interface WalletBalances {
  balances: Record<string, string>; // token address -> raw balance (wei)
  list: AssetBalanceEntry[];
}

export interface AssetBalanceEntry {
  symbol: string;
  address: string;
  decimals: number;
  native: boolean;
  rawBalance: string;
  balance: string;
}

export interface WalletTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  asset: string;
  timestamp: number;
  direction: 'sent' | 'received';
  status: 'pending' | 'confirmed' | 'failed';
}

/** Backend challenge: { challenge: { deploymentKey, domain, types, primaryType, message } }. */
export interface AuthChallenge {
  challenge: {
    deploymentKey: string;
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: string;
    };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: {
      wallet: string;
      telegramUserId: string;
      nonce: string;
      issuedAt: string;
      expiresAt: string;
    };
  };
}

export interface AuthVerifyResponse {
  token: string;
  expiresAt: number;
}

/** Backend session: { deploymentKey, user, wallet, expiresAt } (no chainId). */
export interface SessionInfo {
  deploymentKey: string;
  user: string;
  wallet: string;
  expiresAt: number;
}

export interface ApiError {
  error: string;
  message: string;
}

export interface SimulationResult {
  success: boolean;
  revert?: string;
  note?: string;
}

export interface TransactionSubmitResponse {
  status: string;
  note?: string;
}

/** Frontend receipt view, built from the ethers provider (not the backend). */
export interface TransactionStatus {
  hash: string;
  status: 'pending' | 'confirmed' | 'failed';
  blockNumber?: number;
  confirmations?: number;
  receipt?: {
    status: number;
    gasUsed: string;
  };
}

/** KeyManager types — single source in lib/keymanager (vendored Phase 5). */
export type {
  KeyHandle,
  GeneratedKey,
  SignableTransaction,
  KeyManager,
  KeyManagerErrorCode,
} from '@/lib/keymanager/types';
export { KeyManagerError } from '@/lib/keymanager/types';

/** Signing page payload types (from backend/wallet-client/client.ts) */
export type SigningPayloadKind = 'wallet_challenge' | 'transaction';

export interface SigningPayloadBase {
  kind: SigningPayloadKind;
  callback?: string;
  explorerTxBaseUrl?: string;
}

export interface WalletChallengePayload extends SigningPayloadBase {
  kind: 'wallet_challenge';
  challenge: AuthChallenge['challenge'];
}

export interface TransactionPayload extends SigningPayloadBase {
  kind: 'transaction';
  transaction: PreparedTransaction;
}

export type SigningPayload = WalletChallengePayload | TransactionPayload;

/** Create vault request (sent as { interval, maxMisses, beneficiaries }). */
export interface CreateVaultRequest {
  intervalSeconds: number;       // seconds
  maxMisses: number;             // 1-5
  beneficiaries: Array<{
    account: string;
    allocationBps: number;
  }>;
}

/** Update beneficiaries request */
export interface UpdateBeneficiariesRequest {
  accounts: string[];
  allocationBps: number[];
}

/** Update settings request */
export interface UpdateSettingsRequest {
  checkInInterval?: number;
  maxMissedCheckIns?: number;
}

/** Deposit/withdraw request */
export interface DepositRequest {
  asset: string;  // token address or ETH sentinel
  amount: string; // wei
}