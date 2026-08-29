// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.sol";
import {MockERC20} from "./MockERC20.sol";
import {KinnVault} from "../src/KinnVault.sol";

contract KinnVaultAssetsTest is Base {
    function test_DepositAndWithdrawERC20() public {
        _depositToken(100 ether);
        assertEq(vault.protectedAssetBalance(address(token)), 100 ether);
        assertEq(token.balanceOf(address(vault)), 100 ether);
        assertEq(vault.getTrackedAssets().length, 1);
        assertEq(vault.getTrackedAssets()[0], address(token));

        vm.prank(owner);
        vault.withdraw(address(token), 40 ether);
        assertEq(vault.protectedAssetBalance(address(token)), 60 ether);
        assertEq(token.balanceOf(owner), 40 ether);
    }

    function test_DepositRecordsAssetOnce() public {
        _depositToken(10 ether);
        _depositToken(5 ether);
        assertEq(vault.getTrackedAssets().length, 1);
        assertEq(vault.protectedAssetBalance(address(token)), 15 ether);
    }

    function test_DepositETHAndWithdraw() public {
        _depositETH(2 ether);
        assertEq(vault.protectedAssetBalance(ETH_SENTINEL), 2 ether);
        assertEq(vault.getTrackedAssets().length, 1);
        assertEq(vault.getTrackedAssets()[0], ETH_SENTINEL);

        uint256 before = owner.balance;
        vm.prank(owner);
        vault.withdraw(ETH_SENTINEL, 1.5 ether);
        assertEq(owner.balance, before + 1.5 ether);
        assertEq(vault.protectedAssetBalance(ETH_SENTINEL), 0.5 ether);
    }

    function test_DepositETH_ReserveIsNotProtectedBalance() public {
        _topUpReserve(1 ether);
        _depositETH(2 ether);
        assertEq(address(vault).balance, 3 ether);
        assertEq(vault.protectedAssetBalance(ETH_SENTINEL), 2 ether);
    }
    function test_Deposit_RevertOnInvalidInputs() public {
        vm.startPrank(owner);
        token.approve(address(vault), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidToken.selector, address(0)));
        vault.deposit(address(0), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidToken.selector, ETH_SENTINEL));
        vault.deposit(ETH_SENTINEL, 1 ether);
        vm.expectRevert(KinnVault.InvalidAmount.selector);
        vault.deposit(address(token), 0);
        vm.expectRevert(KinnVault.InvalidAmount.selector);
        vault.depositETH{value: 0}();
        vm.stopPrank();
    }

    function test_Deposit_RejectsFailingTransfer() public {
        // transferFrom that returns false (insufficient balance) fails the deposit:
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.TokenTransferFailed.selector, address(token)));
        vault.deposit(address(token), 1 ether);
        vm.stopPrank();
    }

    function test_Deposit_RevertIfNotEligibleState() public {
        _warpToEligibility();
        token.mint(owner, 10 ether);
        vm.startPrank(owner);
        token.approve(address(vault), 10 ether);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.NotConfigurable.selector, owner));
        vault.deposit(address(token), 10 ether);
        vm.stopPrank();
    }

    function test_Withdraw_RevertOnBadAmountOrUnknownToken() public {
        vm.startPrank(owner);
        vm.expectRevert(KinnVault.InvalidAmount.selector);
        vault.withdraw(address(token), 0);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidToken.selector, address(0)));
        vault.withdraw(address(0), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InsufficientBalance.selector, 0, 1 ether));
        vault.withdraw(address(token), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InsufficientBalance.selector, 0, 1 ether));
        vault.withdraw(ETH_SENTINEL, 1 ether);
        vm.stopPrank();
    }

    function test_Withdraw_ERC20InsufficientBalance() public {
        _depositToken(10 ether);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InsufficientBalance.selector, 10 ether, 11 ether));
        vault.withdraw(address(token), 11 ether);
    }

    // ---- Automation reserve ----

    function test_TopUpAndWithdrawReserve() public {
        _topUpReserve(1 ether);
        assertEq(vault.automationReserve(), 1 ether);

        uint256 before = owner.balance;
        vm.prank(owner);
        vault.withdrawAutomationReserve(0.4 ether);
        assertEq(vault.automationReserve(), 0.6 ether);
        assertEq(owner.balance, before + 0.4 ether);
    }

    function test_Reserve_RevertOnInvalidWithdraw() public {
        _topUpReserve(1 ether);
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InsufficientAutomationReserve.selector, 1 ether, 0));
        vault.withdrawAutomationReserve(0);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InsufficientAutomationReserve.selector, 1 ether, 2 ether));
        vault.withdrawAutomationReserve(2 ether);
        vm.stopPrank();
    }
}
