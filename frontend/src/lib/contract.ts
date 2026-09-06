/**
 * Client-side calldata encoding (Phase 12).
 *
 * The backend exposes dedicated prepare endpoints only for: create-vault,
 * check-in, close, beneficiary PUT/DELETE. Everything else (settings,
 * reserve top-up/withdraw, ERC-20 approve, ETH/ERC-20 deposit/withdraw) is
 * encoded HERE with ethers and sent through the generic
 * POST /transactions/prepare, which fills chainId/to and returns the
 * unsigned `PreparedTransaction` for the KeyManager to sign.
 *
 * Fragments mirror backend/src/contracts/vaultAbi.ts + factoryAbi.ts exactly.
 */

import { Interface } from 'ethers';
import type { PreparedTransaction } from '@/types';
import type { ApiClient } from './api';

const VAULT_IFACE = new Interface([
  'function updateSettings(uint64 checkInInterval,uint8 maxMissedCheckIns)',
  'function updateBeneficiaries(address[] accounts,uint16[] allocationsBps)',
  'function checkIn()',
  'function closeVault()',
  'function deposit(address token,uint256 amount)',
  'function depositETH() payable',
  'function withdraw(address token,uint256 amount)',
  'function topUpAutomationReserve() payable',
  'function withdrawAutomationReserve(uint256 amount)',
]);

const FACTORY_IFACE = new Interface([
  'function createVault(uint64 checkInInterval,uint8 maxMissedCheckIns,address[] accounts,uint16[] allocationsBps) returns (address vault)',
]);

const ERC20_IFACE = new Interface([
  'function approve(address spender,uint256 amount) returns (bool)',
]);

/** Native ETH as the contract models it (matches ETH_SENTINEL). */
export const ETH_SENTINEL = '0x1111111111111111111111111111111111111111';

function toHex(value: bigint | string): string {
  const big = typeof value === 'string' ? BigInt(value) : value;
  return '0x' + big.toString(16);
}

async function prepareViaApi(
  api: ApiClient,
  to: string,
  data: string,
  value: bigint | string,
  from?: string
): Promise<PreparedTransaction> {
  return api.transactions.prepare({
    to,
    data,
    value: typeof value === 'string' ? value : toHex(value),
    from,
  });
}

export function encodeCreateVault(
  intervalSeconds: number,
  maxMisses: number,
  accounts: string[],
  allocationsBps: number[]
): string {
  return FACTORY_IFACE.encodeFunctionData('createVault', [
    BigInt(intervalSeconds),
    maxMisses,
    accounts,
    allocationsBps,
  ]);
}

export const contractWrites = {
  updateSettings: (
    api: ApiClient,
    vault: string,
    intervalSeconds: number,
    maxMisses: number,
    from?: string
  ) =>
    prepareViaApi(
      api,
      vault,
      VAULT_IFACE.encodeFunctionData('updateSettings', [BigInt(intervalSeconds), maxMisses]),
      0n,
      from
    ),

  /** ERC-20 deposit. Caller must approve the vault first (see approve below). */
  depositToken: (api: ApiClient, vault: string, token: string, amountWei: string, from?: string) =>
    prepareViaApi(
      api,
      vault,
      VAULT_IFACE.encodeFunctionData('deposit', [token, BigInt(amountWei)]),
      0n,
      from
    ),

  /** Native ETH deposit — amount carried in tx.value. */
  depositETH: (api: ApiClient, vault: string, amountWei: string, from?: string) =>
    prepareViaApi(api, vault, VAULT_IFACE.encodeFunctionData('depositETH', []), amountWei, from),

  /** Withdraw any tracked asset (use ETH_SENTINEL for native ETH). */
  withdraw: (api: ApiClient, vault: string, token: string, amountWei: string, from?: string) =>
    prepareViaApi(
      api,
      vault,
      VAULT_IFACE.encodeFunctionData('withdraw', [token, BigInt(amountWei)]),
      0n,
      from
    ),

  /** Reserve top-up — amount carried in tx.value. */
  topUpReserve: (api: ApiClient, vault: string, amountWei: string, from?: string) =>
    prepareViaApi(
      api,
      vault,
      VAULT_IFACE.encodeFunctionData('topUpAutomationReserve', []),
      amountWei,
      from
    ),

  withdrawReserve: (api: ApiClient, vault: string, amountWei: string, from?: string) =>
    prepareViaApi(
      api,
      vault,
      VAULT_IFACE.encodeFunctionData('withdrawAutomationReserve', [BigInt(amountWei)]),
      0n,
      from
    ),

  /** Approve the vault instance to pull an ERC-20. Sent to the TOKEN contract. */
  approveToken: (api: ApiClient, token: string, vault: string, amountWei: string, from?: string) =>
    prepareViaApi(
      api,
      token,
      ERC20_IFACE.encodeFunctionData('approve', [vault, BigInt(amountWei)]),
      0n,
      from
    ),
};
