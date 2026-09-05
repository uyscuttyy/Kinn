/** Utility functions for formatting, parsing, and helpers */

import type { Asset } from '@/types';

/** BigInt helpers */
export function parseBigInt(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  return BigInt(value);
}

export function formatBigInt(value: bigint | string, decimals: number): string {
  const big = typeof value === 'string' ? parseBigInt(value) : value;
  const divisor = 10n ** BigInt(decimals);
  const whole = big / divisor;
  const fraction = big % divisor;
  if (fraction === 0n) return whole.toString();
  const fracStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

export function formatUnits(value: string | bigint, decimals: number): string {
  return formatBigInt(value, decimals);
}

/** Address formatting */
export function formatAddress(address: string, chars = 4): string {
  if (!address || address.length < chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}

export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/** BPS (basis points) formatting */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function parseBps(percentage: string): number {
  const num = parseFloat(percentage.replace('%', ''));
  return Math.round(num * 100);
}

/** Time formatting */
export function formatTimestamp(timestamp: number | string): string {
  const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
  return new Date(ts * 1000).toLocaleString();
}

export function formatRelativeTime(timestamp: number | string): string {
  const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
  const now = Math.floor(Date.now() / 1000);
  const diff = ts - now;

  if (diff <= 0) return 'Now';

  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatDeadline(deadline: number | string): {
  text: string;
  isOverdue: boolean;
  isWarning: boolean; // < 24h
  isCritical: boolean; // < 1h
} {
  const ts = typeof deadline === 'string' ? parseInt(deadline, 10) : deadline;
  const now = Math.floor(Date.now() / 1000);
  const diff = ts - now;

  if (diff <= 0) {
    return { text: 'Overdue', isOverdue: true, isWarning: true, isCritical: true };
  }

  const hours = diff / 3600;
  const isCritical = hours < 1;
  const isWarning = hours < 24;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = Math.floor(hours % 24);
    return {
      text: remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`,
      isOverdue: false,
      isWarning,
      isCritical,
    };
  }

  const mins = Math.floor((diff % 3600) / 60);
  return {
    text: `${Math.floor(hours)}h ${mins}m`,
    isOverdue: false,
    isWarning,
    isCritical,
  };
}

/** Inheritance state helpers */
export type InheritanceState =
  | 'Active'
  | 'Missed'
  | 'Eligible'
  | 'Distributing'
  | 'Distributed'
  | 'Closed';

export function getStateBadgeClass(state: InheritanceState): string {
  switch (state) {
    case 'Active':
      return 'badge-active';
    case 'Missed':
      return 'badge-missed';
    case 'Eligible':
      return 'badge-eligible';
    case 'Distributing':
      return 'badge-distributing';
    case 'Distributed':
      return 'badge-distributed';
    case 'Closed':
      return 'badge-closed';
    default:
      return 'badge-info';
  }
}

export function getStateLabel(state: InheritanceState): string {
  return state;
}

export function getStateDescription(state: InheritanceState): string {
  switch (state) {
    case 'Active':
      return 'Vault is active. You can deposit, withdraw, check in, and manage beneficiaries.';
    case 'Missed':
      return 'At least one check-in was missed. You can still check in to reset the timer.';
    case 'Eligible':
      return 'Inheritance conditions met. The vault can now be triggered by anyone.';
    case 'Distributing':
      return 'Inheritance has been triggered. Assets are being distributed to beneficiaries.';
    case 'Distributed':
      return 'All assets have been distributed. The vault is now closed.';
    case 'Closed':
      return 'Vault was closed by the owner while empty. A new vault can be created.';
    default:
      return '';
  }
}

/** Asset helpers */
export const ETH_SENTINEL = '0x0000000000000000000000000000000000000001';

export function isNativeEth(asset: Asset): boolean {
  return asset.native || asset.address.toLowerCase() === ETH_SENTINEL.toLowerCase();
}

export function getAssetIconClass(asset: Asset): string {
  return isNativeEth(asset) ? 'asset-icon-eth' : 'asset-icon-usdc';
}

export function getAssetSymbol(asset: Asset): string {
  return asset.symbol;
}

/** Allocation bar width */
export function getAllocationWidth(bps: number): number {
  return Math.max(0, Math.min(100, (bps / 10000) * 100));
}

/** Transaction status helpers */
export type TxStatus = 'pending' | 'confirming' | 'confirmed' | 'failed';

export function getTxStatusClass(status: TxStatus): string {
  switch (status) {
    case 'pending':
      return 'tx-status-pending';
    case 'confirming':
      return 'tx-status-confirming';
    case 'confirmed':
      return 'tx-status-confirmed';
    case 'failed':
      return 'tx-status-failed';
    default:
      return 'tx-status-pending';
  }
}

/** Class name utility */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Debounce */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/** Copy to clipboard */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.readOnly = true;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      // ignore
    }
    area.remove();
    return copied;
  }
}

/** Generate random ID */
export function generateId(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sleep utility */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Validate allocation sum */
export function validateAllocations(allocations: number[]): { valid: boolean; total: number; error?: string } {
  const total = allocations.reduce((sum, a) => sum + a, 0);
  if (allocations.some((a) => a <= 0)) {
    return { valid: false, total, error: 'All allocations must be greater than 0' };
  }
  if (total !== 10000) {
    return { valid: false, total, error: `Allocations must sum to 10000 bps (100%), got ${total}` };
  }
  return { valid: true, total };
}

/** Parse error message from contract revert */
export function parseRevertReason(revert: string): string {
  // Common revert patterns
  if (revert.includes('NotOwner')) return 'Only the vault owner can perform this action';
  if (revert.includes('InheritanceNotEligible')) return 'Vault is not yet eligible for inheritance';
  if (revert.includes('VaultInactive')) return 'Vault is not active';
  if (revert.includes('InvalidAllocation')) return 'Beneficiary allocations must sum to 100%';
  if (revert.includes('TokenTransferFailed')) return 'Token transfer failed — will be retried automatically';
  if (revert.includes('InheritanceAlreadyTriggered')) return 'Inheritance has already been triggered';
  if (revert.includes('Unauthorized')) return 'Unauthorized action';
  if (revert.includes('ZeroAmount')) return 'Amount must be greater than zero';
  if (revert.includes('InsufficientBalance')) return 'Insufficient balance';
  if (revert.includes('InvalidBeneficiary')) return 'Invalid beneficiary address';
  if (revert.includes('MaxBeneficiariesExceeded')) return 'Maximum 50 beneficiaries allowed';
  if (revert.includes('InvalidInterval')) return 'Check-in interval must be between 1 second and 9 weeks';
  if (revert.includes('InvalidMaxMissed')) return 'Max missed check-ins must be between 1 and 5';
  if (revert.includes('VaultExists')) return 'A vault already exists for this owner';
  if (revert.includes('NoVault')) return 'No vault found for this owner';
  if (revert.includes('VaultNotEmpty')) return 'Vault must be empty to close';
  if (revert.includes('ReserveNotClaimable')) return 'Automation reserve not yet claimable';

  // Return cleaned revert reason
  return revert.replace(/^execution reverted: /, '').replace(/^revert /, '');
}