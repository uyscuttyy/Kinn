// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {KinnVault} from "./KinnVault.sol";

/// @title KinnVaultFactory
/// @notice Deploys and registers KinnVault instances (one vault per owner) via CREATE2.
/// @dev The factory is the only deployer. It records the owner -> vault mapping for discovery and
///      idempotently prevents duplicate vaults (reverts if the owner already has one). The factory
///      cannot configure, withdraw, or trigger inheritance on an owner's behalf; all owner actions
///      are authorized by the instance's on-chain `owner` guard.
contract KinnVaultFactory {
    // ---- Errors ----------------------------------------------------------
    error VaultAlreadyExists(address owner);
    error NotEOA(address caller);

    // ---- Storage ---------------------------------------------------------
    uint256 public immutable automationFeeWei;
    address[] private _vaults;
    mapping(address owner => address vault) public vaultOf; // address(0) means none
    uint256 private _nonce;

    // ---- Events ----------------------------------------------------------
    event VaultCreated(address indexed owner, address indexed vault, bytes32 salt);

    constructor(uint256 _automationFeeWei) {
        automationFeeWei = _automationFeeWei;
    }

    /// @notice Creates the caller's vault. Idempotent-per-owner: reverts if the caller already has one.
    function createVault(
        uint64 checkInInterval,
        uint8 maxMissedCheckIns,
        address[] calldata accounts,
        uint16[] calldata allocationsBps
    ) external returns (address vault) {
        if (vaultOf[msg.sender] != address(0)) revert VaultAlreadyExists(msg.sender);
        bytes32 salt = keccak256(abi.encode(msg.sender, _nonce++));
        KinnVault instance = new KinnVault{salt: salt}(
            address(this),
            msg.sender,
            checkInInterval,
            maxMissedCheckIns,
            accounts,
            allocationsBps,
            automationFeeWei
        );
        vault = address(instance);
        vaultOf[msg.sender] = vault;
        _vaults.push(vault);
        emit VaultCreated(msg.sender, vault, salt);
    }

    // ---- Discovery -------------------------------------------------------
    function vaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    function vaultAt(uint256 index) external view returns (address) {
        return _vaults[index];
    }

    /// @notice Whether an address is a vault deployed by this factory.
    function isVault(address candidate) external view returns (bool) {
        return candidate != address(0) && _vaultExists(candidate);
    }

    function _vaultExists(address candidate) private view returns (bool) {
        uint256 length = _vaults.length;
        for (uint256 i; i < length; ++i) {
            if (_vaults[i] == candidate) return true;
        }
        return false;
    }
}