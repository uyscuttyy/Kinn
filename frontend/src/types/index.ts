/** Kinn Frontend Types — mirrors backend API.md exactly */

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

export interface PreparedTransaction {
  chainId: number;
  to: string;
  data: string;
  value: string;
  from: string;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  nonce: string;
}

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
}

export interface VaultActivityEvent {
  type: string;
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
  state: InheritanceState;
  nextExpectedCheckIn: string;    // unix timestamp (seconds)
}

export interface DistributionInfo {
  processed: Record<string, boolean>;           // token address -> processed
  pendingEntitlements: Record<string, PendingEntitlement[]>; // token -> []
  distributedAmounts: Record<string, string>;   // token address -> total distributed
}

export interface PendingEntitlement {
  beneficiary: string;
  amount: string;
  nextRetryAt: string; // unix timestamp (seconds)
}

export interface WalletBalances {
  balances: Record<string, string>; // token address -> balance (wei)
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

export interface AuthChallenge {
  challenge: {
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
      user: string;
      nonce: string;
      issuedAt: number;
      expiresAt: number;
    };
  };
}

export interface AuthVerifyResponse {
  token: string;
  expiresAt: number;
}

export interface SessionInfo {
  wallet: string;
  chainId: number;
  expiresAt: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export interface SimulationResult {
  success: boolean;
  revert?: string;
  returnValue?: string;
}

export interface TransactionSubmitResponse {
  hash: string;
  status: 'pending';
}

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

/** KeyManager types (from backend/wallet-client/keymanager/types.ts) */
export interface KeyHandle {
  id: string;
  createdAt: number;
  label?: string;
}

export interface GeneratedKey extends KeyHandle {
  address: string;
}

export interface SignableTransaction {
  to?: string;
  from?: string;
  nonce?: number | string;
  gasLimit?: number | string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  data?: string;
  value?: string;
  chainId?: number;
  type?: number;
}

export type KeyManagerErrorCode =
  | 'KEY_NOT_FOUND'
  | 'KEY_LOCKED'
  | 'WRONG_PASSPHRASE'
  | 'STORAGE_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'CRYPTO_UNAVAILABLE';

export class KeyManagerError extends Error {
  readonly code: KeyManagerErrorCode;

  constructor(code: KeyManagerErrorCode, message: string) {
    super(message);
    this.name = 'KeyManagerError';
    this.code = code;
  }
}

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

/** Create vault request */
export interface CreateVaultRequest {
  checkInInterval: number;        // seconds
  maxMissedCheckIns: number;      // 1-5
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