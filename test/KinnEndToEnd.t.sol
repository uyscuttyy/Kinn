// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.sol";
import {KinnVault} from "../src/KinnVault.sol";

contract KinnEndToEndTest is Base {
    function test_FullLifecycle_ETHAndToken() public {
        // Owner deposits both asset types and funds the automation reserve.
        _depositETH(4 ether);
        _depositToken(1000 ether);
        _topUpReserve(1 ether);
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Active));

        // Owner misses check-ins; a check-in partway extends the deadline.
        vm.warp(block.timestamp + INTERVAL * 2);
        vm.prank(owner);
        vault.checkIn();

        // Eventually the deadline passes and anyone can trigger.
        vm.warp(vault.eligibilityDeadline());
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Eligible));
        vm.prank(keeper);
        vault.triggerInheritance();
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Distributing));
        assertEq(vault.automationReserve(), 0.9 ether); // 1 ether - 0.1 ether fee

        // Each asset is distributed separately with equal halves.
        vm.startPrank(keeper);
        vault.distributeInheritanceAsset(ETH_SENTINEL);
        vault.distributeInheritanceAsset(address(token));
        vm.stopPrank();

        assertEq(beneficiaryA.balance, 2 ether);
        assertEq(beneficiaryB.balance, 2 ether);
        assertEq(token.balanceOf(beneficiaryA), 500 ether);
        assertEq(token.balanceOf(beneficiaryB), 500 ether);
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Distributed));

        // Owner can no longer touch the vault.
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultInactive.selector, owner));
        vault.withdraw(ETH_SENTINEL, 1 ether);
        vm.stopPrank();

        // Trigger paid 0.1 ether and each of the two asset distributions paid 0.1 ether;
        // remaining 0.7 ether is claimed by the keeper.
        uint256 keeperBefore = keeper.balance;
        vm.prank(keeper);
        vault.claimAutomationReserve();
        assertEq(keeper.balance, keeperBefore + 0.7 ether);
        assertEq(address(vault).balance, 0);
    }

    function test_CheckInLoopKeepsVaultAlive() public {
        _depositETH(1 ether);
        for (uint256 i; i < 10; ++i) {
            vm.warp(block.timestamp + INTERVAL * 2);
            vm.prank(owner);
            vault.checkIn();
        }
        assertFalse(vault.inheritanceEligible());
        assertEq(vault.missedCheckIns(), 0);
        assertEq(vault.protectedAssetBalance(ETH_SENTINEL), 1 ether);
    }
}
