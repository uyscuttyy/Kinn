/**
 * KinnVault instance ABI (Phase 6).
 *
 * Mirrors src/KinnVault.sol exactly: self-contained per-owner vault instance
 * addressing. All owner actions are authorized on-chain by `onlyOwner`; the
 * keeper/manager actions (trigger/distribute/retry/claim) are permissionless
 * but validated by the contract. The backend only reads state and prepares
 * UNSIGNED transactions — it never signs or submits on the owner's behalf.
 */

/**
 * KinnVault.InheritanceState enum order (matches the Solidity declaration).
 * Stable string names are used across the API/DB layer.
 */
export const INHERITANCE_STATES = [
  "Active",
  "Missed",
  "Eligible",
  "Distributing",
  "Distributed",
  "Closed",
] as const;

export type InheritanceStateName = (typeof INHERITANCE_STATES)[number];

export function inheritanceStateName(value: number): InheritanceStateName {
  const name = INHERITANCE_STATES[value];
  if (!name) throw new Error(`Unknown inheritance state index: ${value}`);
  return name;
}

/** Native ETH represented as a uniform asset address (matches ETH_SENTINEL). */
export const ETH_SENTINEL = "0x1111111111111111111111111111111111111111";

export const vaultAbi = [
  // ---- Views --------------------------------------------------------------
  "function owner() view returns (address)",
  "function factory() view returns (address)",
  "function closed() view returns (bool)",
  "function inheritanceTriggered() view returns (bool)",
  "function lastCheckIn() view returns (uint64)",
  "function checkInInterval() view returns (uint64)",
  "function maxMissedCheckIns() view returns (uint8)",
  "function automationReserve() view returns (uint128)",
  "function automationFeeWei() view returns (uint256)",
  "function state() view returns (uint8)",
  "function inheritanceEligible() view returns (bool)",
  "function eligibilityDeadline() view returns (uint256)",
  "function nextExpectedCheckIn() view returns (uint256)",
  "function missedCheckIns() view returns (uint8)",
  "function getBeneficiaries() view returns ((address account,uint16 allocationBps)[])",
  "function getTrackedAssets() view returns (address[])",
  "function protectedAssetBalance(address asset) view returns (uint256)",
  "function inheritanceAssetProcessed(address asset) view returns (bool)",
  "function pendingInheritance(address asset,address beneficiary) view returns (uint256)",
  "function nextDistributionRetry(address asset,address beneficiary) view returns (uint256)",

  // ---- Owner actions ------------------------------------------------------
  "function updateSettings(uint64 checkInInterval,uint8 maxMissedCheckIns)",
  "function updateBeneficiaries(address[] accounts,uint16[] allocationsBps)",
  "function checkIn()",
  "function closeVault()",
  "function deposit(address token,uint256 amount)",
  "function depositETH() payable",
  "function withdraw(address token,uint256 amount)",
  "function topUpAutomationReserve() payable",
  "function withdrawAutomationReserve(uint256 amount)",

  // ---- Permissionless keeper/manager actions ------------------------------
  "function triggerInheritance()",
  "function distributeInheritanceAsset(address asset)",
  "function retryInheritanceDistribution(address asset,address beneficiary)",
  "function claimAutomationReserve()",

  // ---- Events (indexing) --------------------------------------------------
  "event VaultInitialized(address indexed owner,uint64 checkInInterval,uint8 maxMissedCheckIns,uint64 lastCheckIn)",
  "event VaultSettingsUpdated(address indexed owner,uint64 checkInInterval,uint8 maxMissedCheckIns)",
  "event BeneficiariesUpdated(address indexed owner,address[] accounts,uint16[] allocationsBps)",
  "event AssetDeposited(address indexed owner,address indexed token,uint256 amount)",
  "event EthDeposited(address indexed owner,uint256 amount)",
  "event AssetWithdrawn(address indexed owner,address indexed token,uint256 amount)",
  "event EthWithdrawn(address indexed owner,uint256 amount)",
  "event CheckedIn(address indexed owner,uint64 timestamp)",
  "event VaultClosed(address indexed owner)",
  "event InheritanceTriggered(address indexed owner,address indexed executor,uint64 timestamp)",
  "event InheritanceAssetProcessed(address indexed owner,address indexed asset,uint256 amount)",
  "event InheritanceDistributed(address indexed owner,address indexed asset,address indexed beneficiary,uint256 amount)",
  "event InheritanceDistributionFailed(address indexed owner,address indexed asset,address indexed beneficiary,uint256 amount,uint256 nextRetryAt)",
  "event AutomationReserveToppedUp(address indexed owner,uint256 amount,uint256 newBalance)",
  "event AutomationReserveWithdrawn(address indexed owner,uint256 amount,uint256 newBalance)",
  "event AutomationFeePaid(address indexed owner,address indexed caller,uint256 amount,uint256 remaining)"
] as const;