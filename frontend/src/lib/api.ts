/**
 * API client — typed against the REAL backend (backend/src/web/KinnHttpApi.ts).
 *
 * Backend facts this client encodes (do not guess otherwise):
 * - Errors are `{ error: "CODE", message }` (flat string code).
 * - Auth verify takes `{ nonce, signature }`; session returns
 *   `{ deploymentKey, user, wallet, expiresAt }` (no chainId).
 * - Vault status is wrapped: `{ status: {...} }`; state is DERIVED client-side
 *   (the backend returns active/triggered/missed/eligible flags, no state string).
 * - Balances/activity are arrays, not maps.
 * - Create-vault body is `{ interval, maxMisses, beneficiaries }`.
 * - Beneficiary PUT body is `{ beneficiaries: [...] }`.
 * - There are NO dedicated settings/reserve/approve/deposit/withdraw endpoints:
 *   those are encoded client-side (see lib/contract.ts) and sent through
 *   POST /transactions/prepare, which returns `{ prepared }` (wrapped).
 * - POST /transactions/submit never broadcasts (202 unbroadcast by design);
 *   the frontend broadcasts signed txs itself via an ethers provider.
 */

import type {
  NetworkKey,
  PreparedTransaction,
  VaultStatus,
  BeneficiariesResponse,
  InheritanceInfo,
  DistributionInfo,
  WalletBalances,
  VaultActivityEvent,
  Asset,
  AuthChallenge,
  AuthVerifyResponse,
  SessionInfo,
  SimulationResult,
  CreateVaultRequest,
  UpdateBeneficiariesRequest,
  DepositRequest,
} from '@/types';

const API_BASE = '/api/v1';

/** Raw backend error shape: { error: "CODE", message }. */
interface RawError {
  error?: string;
  message?: string;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData: RawError | null = null;
    try {
      errorData = await response.json();
    } catch {
      // ignore parse errors
    }
    const code =
      typeof errorData?.error === 'string' ? errorData.error : `HTTP_${response.status}`;
    const message = errorData?.message || response.statusText;
    throw new ApiClientError(code, message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }

  /** True when the backend reports the owner simply has no vault. */
  get isNoVault(): boolean {
    return /no vault exists/i.test(this.message);
  }
}

function getAuthHeaders(token: string | null): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function buildUrl(networkKey: NetworkKey, path: string): string {
  return `${API_BASE}/${networkKey}${path}`;
}

/** Raw backend vault status (inside `{ status }`). */
interface RawVaultStatus {
  owner: string;
  address: string;
  lastCheckIn: string;
  checkInInterval: string;
  maxMissedCheckIns: number;
  active: boolean;
  inheritanceTriggered: boolean;
  automationReserve: string;
  beneficiaries: Array<{ account: string; allocationBps: number }>;
  assets: string[];
  balances: Record<string, string>;
  nextExpectedCheckIn: string;
  missedCheckIns: number;
  inheritanceEligible: boolean;
}

interface RawDistribution {
  assets: Array<{ asset: string; balance: string }>;
}

/** Derive the display state from chain flags + distribution balances. */
function deriveState(
  raw: RawVaultStatus,
  distribution: RawDistribution | null
): VaultStatus['state'] {
  if (raw.inheritanceTriggered) {
    const assets = distribution?.assets ?? [];
    const allEmpty = assets.every((a) => {
      try {
        return BigInt(a.balance) === 0n;
      } catch {
        return false;
      }
    });
    return allEmpty ? 'Distributed' : 'Distributing';
  }
  if (!raw.active) return 'Closed';
  if (raw.inheritanceEligible) return 'Eligible';
  if (raw.missedCheckIns > 0) return 'Missed';
  return 'Active';
}

function adaptStatus(raw: RawVaultStatus, distribution: RawDistribution | null): VaultStatus {
  const interval = BigInt(raw.checkInInterval);
  const deadline = (BigInt(raw.lastCheckIn) + interval * BigInt(raw.maxMissedCheckIns)).toString();
  const balances: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.balances ?? {})) {
    balances[k] = v;
    balances[k.toLowerCase()] = v;
  }
  return {
    owner: raw.owner,
    vaultAddress: raw.address,
    state: deriveState(raw, distribution),
    lastCheckIn: raw.lastCheckIn,
    checkInInterval: raw.checkInInterval,
    maxMissedCheckIns: raw.maxMissedCheckIns,
    reserve: raw.automationReserve,
    balances,
    active: raw.active,
    inheritanceTriggered: raw.inheritanceTriggered,
    missedCheckIns: raw.missedCheckIns,
    inheritanceEligible: raw.inheritanceEligible,
    eligibilityDeadline: deadline,
    nextExpectedCheckIn: raw.nextExpectedCheckIn,
  };
}

interface RawBalanceEntry {
  symbol: string;
  address: string;
  decimals: number;
  native: boolean;
  rawBalance: string;
  balance: string;
}

interface RawActivityEntry {
  key: string;
  name: string;
  address: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  owner: string;
  values: Record<string, unknown>;
}

function adaptActivity(raw: RawActivityEntry): VaultActivityEvent {
  return {
    type: raw.name,
    timestamp: 0,
    txHash: raw.transactionHash,
    blockNumber: raw.blockNumber,
    data: { ...(raw.values ?? {}), owner: raw.owner, contract: raw.address, logIndex: raw.logIndex },
  };
}

export function createApiClient(networkKey: NetworkKey, getToken: () => string | null) {
  const baseFetch = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
    const token = getToken();
    const response = await fetch(buildUrl(networkKey, path), {
      ...options,
      headers: { ...getAuthHeaders(token), ...options.headers },
    });
    return handleResponse<T>(response);
  };

  // ===== Auth =====
  const auth = {
    challenge: (wallet: string) =>
      baseFetch<AuthChallenge>('/auth/challenge', {
        method: 'POST',
        body: JSON.stringify({ networkKey, wallet }),
      }),

    verify: (nonce: string, signature: string) =>
      baseFetch<AuthVerifyResponse>('/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ nonce, signature }),
      }),

    session: (token: string) =>
      baseFetch<SessionInfo>('/auth/session', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),

    logout: (token: string) =>
      baseFetch<{ ok: boolean }>('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
  };

  // ===== Wallet =====
  const wallet = {
    get: () =>
      baseFetch<{ wallet: string; deploymentKey: string; sessionIssuedAt: number }>('/wallet'),

    getAddress: () => baseFetch<{ address: string }>('/wallet/address'),

    getBalances: async (): Promise<WalletBalances> => {
      const raw = await baseFetch<{ balances: RawBalanceEntry[] }>('/wallet/balances');
      const balances: Record<string, string> = {};
      for (const b of raw.balances ?? []) {
        balances[b.address] = b.rawBalance;
        balances[b.address.toLowerCase()] = b.rawBalance;
      }
      return { balances, list: raw.balances ?? [] };
    },

    getTransactions: async (): Promise<{ transactions: VaultActivityEvent[] }> => {
      const raw = await baseFetch<{ transactions: RawActivityEntry[] }>('/wallet/transactions');
      return { transactions: (raw.transactions ?? []).map(adaptActivity) };
    },

    send: (to: string, asset: string, amount: string) =>
      baseFetch<{ prepared: PreparedTransaction }>('/wallet/send', {
        method: 'POST',
        body: JSON.stringify({ to, asset, amount }),
      }),
  };

  // ===== Assets =====
  const assets = {
    get: () => baseFetch<{ assets: Asset[] }>('/assets'),
  };

  // ===== Vault =====
  const vault = {
    create: (request: CreateVaultRequest) =>
      baseFetch<{ prepared: PreparedTransaction }>('/vaults', {
        method: 'POST',
        body: JSON.stringify({
          interval: String(request.intervalSeconds),
          maxMisses: request.maxMisses,
          beneficiaries: request.beneficiaries,
        }),
      }),

    getStatus: async (owner: string): Promise<VaultStatus> => {
      const [statusRaw, distribution] = await Promise.all([
        baseFetch<{ status: RawVaultStatus }>(`/vaults/${owner}/status`),
        baseFetch<RawDistribution>(`/vaults/${owner}/inheritance/distribution`).catch(
          () => null as RawDistribution | null
        ),
      ]);
      return adaptStatus(statusRaw.status, distribution);
    },

    getActivity: async (owner: string): Promise<{ events: VaultActivityEvent[] }> => {
      const raw = await baseFetch<{ activity: RawActivityEntry[] }>(`/vaults/${owner}/activity`);
      return { events: (raw.activity ?? []).map(adaptActivity) };
    },

    close: (owner: string) =>
      baseFetch<{ prepared: PreparedTransaction }>(`/vaults/${owner}/close`, {
        method: 'POST',
      }),

    getBeneficiaries: (owner: string) =>
      baseFetch<BeneficiariesResponse>(`/vaults/${owner}/beneficiaries`),

    updateBeneficiaries: (owner: string, request: UpdateBeneficiariesRequest) =>
      baseFetch<{ prepared: PreparedTransaction }>(`/vaults/${owner}/beneficiaries`, {
        method: 'PUT',
        body: JSON.stringify({
          beneficiaries: request.accounts.map((account, i) => ({
            account,
            allocationBps: request.allocationBps[i],
          })),
        }),
      }),

    removeBeneficiaries: (owner: string) =>
      baseFetch<{ prepared: PreparedTransaction }>(`/vaults/${owner}/beneficiaries`, {
        method: 'DELETE',
      }),

    /** Derived from status (deadline = lastCheckIn + interval * maxMissed). */
    getInheritance: async (owner: string): Promise<InheritanceInfo> => {
      const status = await vault.getStatus(owner);
      return {
        eligibilityDeadline: status.eligibilityDeadline,
        missedCheckIns: status.missedCheckIns,
        maxMissedCheckIns: status.maxMissedCheckIns,
        inheritanceEligible: status.inheritanceEligible,
      };
    },

    checkIn: (owner: string) =>
      baseFetch<{ prepared: PreparedTransaction }>(`/vaults/${owner}/inheritance/checkin`, {
        method: 'POST',
      }),

    getEligibility: async (owner: string): Promise<InheritanceInfo> => vault.getInheritance(owner),

    getDistribution: (owner: string) =>
      baseFetch<DistributionInfo>(`/vaults/${owner}/inheritance/distribution`),
  };

  // ===== Transactions =====
  // NOTE: /transactions/prepare returns `{ prepared }` (wrapped).
  // /transactions/submit never broadcasts (202 unbroadcast by design) — the
  // frontend broadcasts signed txs itself via an ethers provider.
  const transactions = {
    prepare: async (tx: { to: string; data: string; value?: string; from?: string }) => {
      const raw = await baseFetch<{ prepared: PreparedTransaction }>('/transactions/prepare', {
        method: 'POST',
        body: JSON.stringify({ to: tx.to, data: tx.data, value: tx.value ?? '0x0', from: tx.from }),
      });
      return raw.prepared;
    },

    simulate: (prepared: PreparedTransaction) =>
      baseFetch<SimulationResult>('/transactions/simulate', {
        method: 'POST',
        body: JSON.stringify({ prepared }),
      }),
  };

  return { auth, wallet, assets, vault, transactions };
}

export type ApiClient = ReturnType<typeof createApiClient>;
export type { DepositRequest };
