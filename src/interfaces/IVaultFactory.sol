// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IVaultFactory
/// @notice Minimal interface for the KinnVaultFactory consumed by services.
interface IVaultFactory {
    function automationFeeWei() external view returns (uint256);
    function vaultOf(address owner) external view returns (address);
    function vaultCount() external view returns (uint256);
    function vaultAt(uint256 index) external view returns (address);
    function isVault(address candidate) external view returns (bool);

    function createVault(
        uint64 checkInInterval,
        uint8 maxMissedCheckIns,
        address[] calldata accounts,
        uint16[] calldata allocationsBps
    ) external returns (address vault);
}