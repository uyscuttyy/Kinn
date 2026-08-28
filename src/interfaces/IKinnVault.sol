// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IKinnVault
/// @notice Minimal interface for a KinnVault instance consumed by services and the factory.
interface IKinnVault {
    enum InheritanceState { Active, Missed, Eligible, Distributing, Distributed, Closed }

    struct Beneficiary {
        address account;
        uint16 allocationBps;
    }

    function owner() external view returns (address);
    function factory() external view returns (address);
    function automationFeeWei() external view returns (uint256);
    function state() external view returns (InheritanceState);
    function inheritanceEligible() external view returns (bool);
    function eligibilityDeadline() external view returns (uint256);
    function missedCheckIns() external view returns (uint8);
    function lastCheckIn() external view returns (uint64);
    function checkInInterval() external view returns (uint64);
    function maxMissedCheckIns() external view returns (uint8);
    function automationReserve() external view returns (uint128);
    function protectedAssetBalance(address asset) external view returns (uint256);
    function getBeneficiaries() external view returns (Beneficiary[] memory);
    function getTrackedAssets() external view returns (address[] memory);

    function updateSettings(uint64 checkInInterval, uint8 maxMissedCheckIns) external;
    function updateBeneficiaries(address[] calldata accounts, uint16[] calldata allocationsBps) external;
    function checkIn() external;
    function closeVault() external;
    function deposit(address token, uint256 amount) external;
    function depositETH() external payable;
    function withdraw(address token, uint256 amount) external;
    function topUpAutomationReserve() external payable;
    function withdrawAutomationReserve(uint256 amount) external;
    function triggerInheritance() external;
    function distributeInheritanceAsset(address asset) external;
    function retryInheritanceDistribution(address asset, address beneficiary) external;
    function claimAutomationReserve() external;
}