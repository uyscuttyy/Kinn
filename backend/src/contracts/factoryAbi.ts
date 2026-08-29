/**
 * KinnVaultFactory ABI (Phase 6).
 *
 * Mirrors src/VaultFactory.sol: one factory per chain, CREATE2 instance
 * deployment, and a one-vault-per-owner discovery registry. The factory only
 * deploys and registers; it cannot configure, withdraw, or trigger inheritance
 * on an owner's behalf.
 */
export const factoryAbi = [
  "function automationFeeWei() view returns (uint256)",
  "function vaultOf(address owner) view returns (address)",
  "function vaultCount() view returns (uint256)",
  "function vaultAt(uint256 index) view returns (address)",
  "function isVault(address candidate) view returns (bool)",
  "function createVault(uint64 checkInInterval,uint8 maxMissedCheckIns,address[] accounts,uint16[] allocationsBps) returns (address vault)",
  "event VaultCreated(address indexed owner,address indexed vault,bytes32 salt)"
] as const;