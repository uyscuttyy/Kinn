// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {KinnVault} from "../src/KinnVault.sol";
import {MockERC20} from "./MockERC20.sol";

interface Vm {
    function prank(address sender) external;
    function deal(address account, uint256 balance) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
}

contract KinnVaultAssetsTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    KinnVault private vault;
    MockERC20 private token;
    address private constant FACTORY = address(0xFac70);
    address private constant OWNER = address(0xA11CE);
    address private constant ALICE = address(0xB0B);
    address private constant BOB = address(0xCAFE);
    address private constant ETH = 0x1111111111111111111111111111111111111111;
    uint256 private constant FEE = 0.0001 ether;

    function setUp() public {
        vm.deal(OWNER, 100 ether);
        vault = _newVault();
        token = new MockERC20();
        token.mint(OWNER, 1_000_000);
    }

    // ---- ERC-20 deposit / withdraw ---------------------------------------

    function testDepositERC20() public {
        vm.prank(OWNER);
        token.approve(address(vault), 10_000);
        vm.prank(OWNER);
        vault.deposit(address(token), 10_000);
        assertEq(vault.protectedAssetBalance(address(token)), 10_000);
        assertEq(token.balanceOf(address(vault)), 10_000);
        address[] memory assets = vault.getTrackedAssets();
        assertEq(assets.length, 1);
        assertEq(assets[0], address(token));
    }

    function testWithdrawERC20() public {
        _depositToken(10_000);
        vm.prank(OWNER);
        vault.withdraw(address(token), 4_000);
        assertEq(token.balanceOf(OWNER), 1_000_000 - 10_000 + 4_000);
        assertEq(vault.protectedAssetBalance(address(token)), 6_000);
    }

    function testCannotDepositZero() public {
        vm.expectRevert(KinnVault.InvalidAmount.selector);
        vm.prank(OWNER);
        vault.deposit(address(token), 0);
    }

    function testCannotDepositSentinelAsToken() public {
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidToken.selector, ETH));
        vm.prank(OWNER);
        vault.deposit(ETH, 1);
    }

    function testCannotWithdrawMoreThanBalance() public {
        _depositToken(1_000);
        vm.expectRevert(
            abi.encodeWithSelector(KinnVault.InsufficientBalance.selector, 1_000, 1_001)
        );
        vm.prank(OWNER);
        vault.withdraw(address(token), 1_001);
    }

    function testFeeOnTransferTokenDepositRejected() public {
        token.setFailTransfers(true);
        vm.prank(OWNER);
        token.approve(address(vault), 5_000);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.TokenTransferFailed.selector, address(token)));
        vm.prank(OWNER);
        vault.deposit(address(token), 5_000);
        assertEq(vault.getTrackedAssets().length, 0);
    }

    // ---- native ETH deposit / withdraw ------------------------------------

    function testDepositETH() public {
        vm.prank(OWNER);
        vault.depositETH{value: 1 ether}();
        assertEq(vault.protectedAssetBalance(ETH), 1 ether);
        assertEq(address(vault).balance, 1 ether);
    }

    function testWithdrawETH() public {
        vm.prank(OWNER);
        vault.depositETH{value: 1 ether}();
        vm.prank(OWNER);
        vault.withdraw(ETH, 0.4 ether);
        assertEq(vault.protectedAssetBalance(ETH), 0.6 ether);
        assertEq(OWNER.balance, 100 ether - 0.6 ether); // spent 1 deposit, got 0.4 back
    }

    function testCannotWithdrawETHMoreThanProtected() public {
        vm.prank(OWNER);
        vault.depositETH{value: 1 ether}();
        vm.expectRevert(
            abi.encodeWithSelector(KinnVault.InsufficientBalance.selector, 1 ether, 2 ether)
        );
        vm.prank(OWNER);
        vault.withdraw(ETH, 2 ether);
    }

    // ---- automation reserve is separate from protected ETH ----------------

    function testReserveIsSeparateFromProtectedEth() public {
        vm.prank(OWNER);
        vault.topUpAutomationReserve{value: 0.5 ether}();
        vm.prank(OWNER);
        vault.depositETH{value: 1 ether}();
        assertEq(vault.automationReserve(), 0.5 ether);
        assertEq(vault.protectedAssetBalance(ETH), 1 ether);
        assertEq(address(vault).balance, 1.5 ether);
    }

    function testWithdrawAutomationReserve() public {
        vm.prank(OWNER);
        vault.topUpAutomationReserve{value: 0.5 ether}();
        vm.prank(OWNER);
        vault.withdrawAutomationReserve(0.2 ether);
        assertEq(vault.automationReserve(), 0.3 ether);
    }

    function testCannotWithdrawMoreReserveThanHeld() public {
        vm.prank(OWNER);
        vault.topUpAutomationReserve{value: 0.5 ether}();
        vm.expectRevert(
            abi.encodeWithSelector(KinnVault.InsufficientAutomationReserve.selector, 0.5 ether, 1 ether)
        );
        vm.prank(OWNER);
        vault.withdrawAutomationReserve(1 ether);
    }

    // ---- helpers ----------------------------------------------------------

    function _depositToken(uint256 amount) private {
        vm.prank(OWNER);
        token.approve(address(vault), amount);
        vm.prank(OWNER);
        vault.deposit(address(token), amount);
    }

    function _newVault() private returns (KinnVault) {
        address[] memory a = new address[](2);
        uint16[] memory b = new uint16[](2);
        a[0] = ALICE;
        a[1] = BOB;
        b[0] = 6_000;
        b[1] = 4_000;
        return new KinnVault(FACTORY, OWNER, 2 weeks, 3, a, b, FEE);
    }

    function assertEq(uint256 a, uint256 b) private pure {
        require(a == b, "uint equality");
    }

    function assertEq(address a, address b) private pure {
        require(a == b, "address equality");
    }
}