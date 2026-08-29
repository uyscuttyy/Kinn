// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base, ToggleReceiver} from "./Base.sol";
import {MockERC20} from "./MockERC20.sol";
import {KinnVault} from "../src/KinnVault.sol";

contract KinnVaultInheritanceTest is Base {
    function test_TriggerInheritance_Permissionless() public {
        _warpToEligibility();
        vm.prank(keeper);
        vault.triggerInheritance();
        assertTrue(vault.inheritanceTriggered());
        // Empty vault: nothing to distribute, so it lands straight in Distributed.
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Distributed));
    }

    function test_TriggerInheritance_RevertIfNotEligible() public {
        vm.prank(keeper);
        vm.expectRevert(KinnVault.InheritanceNotEligible.selector);
        vault.triggerInheritance();
    }

    function test_TriggerInheritance_RevertIfAlreadyTriggered() public {
        _trigger();
        vm.prank(keeper);
        vm.expectRevert(KinnVault.InheritanceAlreadyTriggered.selector);
        vault.triggerInheritance();
    }

    function test_TriggerInheritance_RevertIfClosed() public {
        vm.prank(owner);
        vault.closeVault();
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultIsClosed.selector, owner));
        vault.triggerInheritance();
    }

    function test_Distribute_ERC20_SplitsWithRoundingRemainderToLast() public {
        _depositToken(101); // odd amount: 50/51 split at 5000 bps each
        _trigger();

        vm.prank(keeper);
        vault.distributeInheritanceAsset(address(token));
        assertEq(token.balanceOf(beneficiaryA), 50);
        assertEq(token.balanceOf(beneficiaryB), 51); // remainder to last beneficiary
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Distributed));
        assertTrue(vault.inheritanceAssetProcessed(address(token)));
        assertEq(vault.processedAssetCount(), 1);
    }

    function test_Distribute_ETH() public {
        _depositETH(3 ether);
        _trigger();

        vm.prank(keeper);
        vault.distributeInheritanceAsset(ETH_SENTINEL);
        assertEq(beneficiaryA.balance, 1.5 ether);
        assertEq(beneficiaryB.balance, 1.5 ether);
        assertEq(address(vault).balance, 0);
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Distributed));
    }

    function test_Distribute_UnknownAsset_Reverts() public {
        _trigger();
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.UnknownAsset.selector, address(token)));
        vault.distributeInheritanceAsset(address(token));
    }

    function test_Distribute_RevertIfNotTriggered() public {
        _depositToken(10 ether);
        vm.prank(keeper);
        vm.expectRevert(KinnVault.InheritanceNotTriggered.selector);
        vault.distributeInheritanceAsset(address(token));
    }
    function test_Distribute_DoubleProcessingPrevented() public {
        _depositToken(10 ether);
        _trigger();
        vm.startPrank(keeper);
        vault.distributeInheritanceAsset(address(token));
        vm.expectRevert(abi.encodeWithSelector(KinnVault.AssetAlreadyProcessed.selector, address(token)));
        vault.distributeInheritanceAsset(address(token));
        vm.stopPrank();
    }

    function test_Distribute_ZeroBalanceAssetStillProcessed() public {
        _depositToken(10 ether);
        vm.prank(owner);
        vault.withdraw(address(token), 10 ether);
        _trigger();

        vm.prank(keeper);
        vault.distributeInheritanceAsset(address(token));
        assertTrue(vault.inheritanceAssetProcessed(address(token)));
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Distributed));
    }

    function test_FailedETHDeliveryStaysPendingAndRetries() public {
        // beneficiaryB initially rejects ETH
        address[] memory accounts = _beneficiaryAccounts();
        ToggleReceiver toggle = new ToggleReceiver();
        accounts[1] = address(toggle);
        uint16[] memory allocations = _equalHalves();
        vm.prank(owner);
        vault.updateBeneficiaries(accounts, allocations);

        _depositETH(2 ether);
        _trigger();

        vm.prank(keeper);
        vault.distributeInheritanceAsset(ETH_SENTINEL);
        assertEq(beneficiaryA.balance, 1 ether);
        assertEq(address(toggle).balance, 0);
        assertEq(vault.pendingInheritance(ETH_SENTINEL, address(toggle)), 1 ether);
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Distributing));
        uint256 retryAt = vault.nextDistributionRetry(ETH_SENTINEL, address(toggle));
        assertEq(retryAt, block.timestamp + INTERVAL);

        // Retry too early reverts
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.RetryNotReady.selector, retryAt));
        vault.retryInheritanceDistribution(ETH_SENTINEL, address(toggle));

        // After the retry window, and once the beneficiary accepts ETH, the
        // entitlement can be delivered to the recorded beneficiary.
        toggle.setAccept(true);
        vm.warp(retryAt);
        vm.prank(keeper);
        vault.retryInheritanceDistribution(ETH_SENTINEL, address(toggle));
        assertEq(address(toggle).balance, 1 ether);
        assertEq(vault.pendingInheritance(ETH_SENTINEL, address(toggle)), 0);
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Distributed));
    }
    function test_FailedTokenDeliveryStaysPendingAndRetries() public {
        _depositToken(10 ether);
        _trigger();

        token.setFailTransfers(true);
        vm.prank(keeper);
        vault.distributeInheritanceAsset(address(token));
        assertEq(vault.pendingInheritance(address(token), beneficiaryA), 5 ether);
        assertEq(vault.pendingInheritance(address(token), beneficiaryB), 5 ether);
        assertEq(token.balanceOf(address(vault)), 10 ether);

        token.setFailTransfers(false);
        vm.warp(block.timestamp + INTERVAL);
        vm.startPrank(keeper);
        vault.retryInheritanceDistribution(address(token), beneficiaryA);
        vault.retryInheritanceDistribution(address(token), beneficiaryB);
        vm.stopPrank();
        assertEq(token.balanceOf(beneficiaryA), 5 ether);
        assertEq(token.balanceOf(beneficiaryB), 5 ether);
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Distributed));
    }

    function test_Distribution_FalseReturningTokenStaysPending() public {
        MockERC20 falseAfter = new MockERC20();
        falseAfter.mint(owner, 10 ether);
        vm.startPrank(owner);
        falseAfter.approve(address(vault), 10 ether);
        vault.deposit(address(falseAfter), 10 ether);
        vm.stopPrank();

        // Token returns false after moving funds (reflection-style): the isolated
        // outgoing transfer fails and the entitlement stays pending, funds unlost.
        falseAfter.setFalseAfterTransfer(true);
        _trigger();
        vm.prank(keeper);
        vault.distributeInheritanceAsset(address(falseAfter));

        assertEq(falseAfter.balanceOf(address(vault)), 10 ether);
        assertEq(vault.pendingInheritance(address(falseAfter), beneficiaryA), 5 ether);
        assertEq(vault.pendingInheritance(address(falseAfter), beneficiaryB), 5 ether);
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Distributing));

        // Once the token behaves, retry delivers the recorded entitlements exactly.
        falseAfter.setFalseAfterTransfer(false);
        vm.warp(block.timestamp + INTERVAL);
        vm.startPrank(keeper);
        vault.retryInheritanceDistribution(address(falseAfter), beneficiaryA);
        vault.retryInheritanceDistribution(address(falseAfter), beneficiaryB);
        vm.stopPrank();
        assertEq(falseAfter.balanceOf(beneficiaryA), 5 ether);
        assertEq(falseAfter.balanceOf(beneficiaryB), 5 ether);
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Distributed));
    }

    function test_Retry_NoPendingReverts() public {
        _trigger();
        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(KinnVault.NoPendingInheritance.selector, ETH_SENTINEL, beneficiaryA)
        );
        vault.retryInheritanceDistribution(ETH_SENTINEL, beneficiaryA);
    }
}
