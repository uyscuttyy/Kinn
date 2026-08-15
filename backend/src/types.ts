export interface VaultView {
  owner: string;
  lastCheckIn: bigint;
  checkInInterval: bigint;
  maxMissedCheckIns: number;
  active: boolean;
  inheritanceTriggered: boolean;
  automationReserve: bigint;
}

export interface BeneficiaryView {
  account: string;
  allocationBps: number;
}

export interface TokenDisplay {
  address: string;
  symbol: string;
  decimals: number;
  rawBalance: bigint;
  formattedBalance: string;
}

export interface VaultStatus {
  vault: VaultView;
  beneficiaries: BeneficiaryView[];
  tokens: string[];
  balances: Record<string, bigint>;
  nextExpectedCheckIn: bigint;
  missedCheckIns: number;
  inheritanceEligible: boolean;
}

export interface PreparedTransaction {
  chainId: number;
  to: string;
  data: string;
  value: string;
}

export interface ChainLog {
  address: string;
  topics: readonly string[];
  data: string;
  blockNumber: number;
  transactionHash: string;
  index: number;
}

export interface ParsedKinnEvent {
  name: string;
  blockNumber: number;
  transactionHash: string;
  values: Record<string, unknown>;
}
