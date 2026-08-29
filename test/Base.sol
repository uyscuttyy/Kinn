// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {KinnVault} from "../src/KinnVault.sol";
import {KinnVaultFactory} from "../src/VaultFactory.sol";
import {MockERC20} from "./MockERC20.sol";

contract RevertingReceiver {
    receive() external payable {
        revert("no");
    }
}

/// @notice Receiver whose acceptance of ETH can be toggled at runtime.
contract ToggleReceiver {
    bool public accept;

    function setAccept(bool value) external {
        accept = value;
    }

    receive() external payable {
        if (!accept) revert("no");
    }
}

abstract contract Base is Test {
    KinnVaultFactory internal factory;
    KinnVault internal vault;
    MockERC20 internal token;
    RevertingReceiver internal revertingReceiver;

    address internal owner = makeAddr("owner");
    address internal beneficiaryA = makeAddr("beneficiaryA");
    address internal beneficiaryB = makeAddr("beneficiaryB");
    address internal keeper = makeAddr("keeper");

    uint64 internal constant INTERVAL = 1 days;
    uint8 internal constant MAX_MISSED = 3;
    uint256 internal constant FEE = 0.1 ether;
    address internal constant ETH_SENTINEL = 0x1111111111111111111111111111111111111111;

    function setUp() public virtual {
        factory = new KinnVaultFactory(FEE);
        token = new MockERC20();
        revertingReceiver = new RevertingReceiver();
        vm.deal(owner, 1000 ether);
        vault = _createVault();
    }

    function _beneficiaryAccounts() internal view returns (address[] memory accounts) {
        accounts = new address[](2);
        accounts[0] = beneficiaryA;
        accounts[1] = beneficiaryB;
    }

    function _equalHalves() internal pure returns (uint16[] memory allocations) {
        allocations = new uint16[](2);
        allocations[0] = 5000;
        allocations[1] = 5000;
    }

    function _createVault() internal returns (KinnVault) {
        vm.startPrank(owner);
        address v = factory.createVault(INTERVAL, MAX_MISSED, _beneficiaryAccounts(), _equalHalves());
        vm.stopPrank();
        return KinnVault(v);
    }

    function _depositToken(uint256 amount) internal {
        token.mint(owner, amount);
        vm.startPrank(owner);
        token.approve(address(vault), amount);
        vault.deposit(address(token), amount);
        vm.stopPrank();
    }

    function _depositETH(uint256 amount) internal {
        vm.prank(owner);
        vault.depositETH{value: amount}();
    }

    function _topUpReserve(uint256 amount) internal {
        vm.prank(owner);
        vault.topUpAutomationReserve{value: amount}();
    }

    function _warpToEligibility() internal {
        vm.warp(block.timestamp + uint256(INTERVAL) * MAX_MISSED);
    }

    function _trigger() internal {
        _warpToEligibility();
        vault.triggerInheritance();
    }
}
