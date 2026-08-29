// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.sol";
import {KinnVault} from "../src/KinnVault.sol";

contract KinnVaultAutomationReserveTest is Base {
    function test_Trigger_PaysFeeFromReserveToCaller() public {
        _topUpReserve(1 ether);
        uint256 keeperBefore = keeper.balance;
        _warpToEligibility();
        vm.prank(keeper);
        vault.triggerInheritance();

        assertEq(vault.automationReserve(), 0.9 ether);
        assertEq(keeper.balance, keeperBefore + 0.1 ether);
    }

    function test_Trigger_PaysPartialFeeIfReserveSmaller() public {
        _topUpReserve(0.04 ether);
        uint256 keeperBefore = keeper.balance;
        _warpToEligibility();
        vm.prank(keeper);
        vault.triggerInheritance();

        assertEq(vault.automationReserve(), 0);
        assertEq(keeper.balance, keeperBefore + 0.04 ether);
    }

    function test_Trigger_WithoutReserveStillSucceeds() public {
        _warpToEligibility();
        vm.prank(keeper);
        vault.triggerInheritance();
        assertEq(vault.automationReserve(), 0);
        assertEq(keeper.balance, 0);
    }

    function test_ClaimReserve_AfterFullDistribution() public {
        _topUpReserve(0.5 ether);
        _depositETH(2 ether);
        _warpToEligibility();

        vm.startPrank(keeper);
        vault.triggerInheritance(); // fee paid: reserve 0.4 ether
        vault.distributeInheritanceAsset(ETH_SENTINEL);
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Distributed));

        uint256 keeperBefore = keeper.balance;
        vault.claimAutomationReserve();
        vm.stopPrank();

        // Trigger + one distribution each paid 0.1 ether fee; remaining 0.3 ether claimed by keeper.
        assertEq(vault.automationReserve(), 0);
        assertEq(keeper.balance, keeperBefore + 0.3 ether);
        assertEq(address(vault).balance, 0);
    }

    function test_ClaimReserve_RevertsIfDistributionIncomplete() public {
        _topUpReserve(0.5 ether);
        _depositETH(2 ether);
        _depositToken(10 ether);
        _trigger();

        vm.startPrank(keeper);
        vault.distributeInheritanceAsset(ETH_SENTINEL);
        vm.expectRevert(KinnVault.InheritanceIncomplete.selector);
        vault.claimAutomationReserve();
        vm.stopPrank();
    }

    function test_ClaimReserve_RevertsIfNotTriggered() public {
        _topUpReserve(0.5 ether);
        vm.prank(keeper);
        vm.expectRevert(KinnVault.InheritanceNotTriggered.selector);
        vault.claimAutomationReserve();
    }
}
