// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {KinnVault} from "../src/KinnVault.sol";
import {MockERC20} from "./MockERC20.sol";

interface VmAssets {
    function prank(address sender) external;
    function expectRevert(bytes calldata data) external;
    function expectRevert(bytes4 selector) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
}

contract KinnVaultAssetsTest {
    VmAssets private constant vm = VmAssets(address(uint160(uint256(keccak256("hevm cheat code")))));
    KinnVault private kinn;
    MockERC20 private tokenA;
    MockERC20 private tokenB;
    address private constant OWNER = address(0xA11CE);
    address private constant ATTACKER = address(0xBAD);
    address private constant ALICE = address(0xB0B);

    event AssetDeposited(address indexed owner, address indexed token, uint256 amount);
    event AssetWithdrawn(address indexed owner, address indexed token, uint256 amount);
    event VaultClosed(address indexed owner);

    function setUp() public {
        kinn = new KinnVault(0.0001 ether);
        tokenA = new MockERC20();
        tokenB = new MockERC20();
        address[] memory accounts = new address[](1);
        uint16[] memory allocations = new uint16[](1);
        accounts[0] = ALICE;
        allocations[0] = 10_000;
        vm.prank(OWNER);
        kinn.createVault(2 weeks, 3, accounts, allocations);
        tokenA.mint(OWNER, 1_000 ether);
        tokenB.mint(OWNER, 500 ether);
    }

    function testDeposit() public {
        _approve(tokenA, 100 ether);
        vm.expectEmit(true, true, false, true, address(kinn));
        emit AssetDeposited(OWNER, address(tokenA), 100 ether);
        vm.prank(OWNER);
        kinn.deposit(address(tokenA), 100 ether);
        _assertEq(kinn.getTokenBalance(OWNER, address(tokenA)), 100 ether);
        _assertEq(tokenA.balanceOf(address(kinn)), 100 ether);
    }

    function testMultipleDepositsAndTokenTypes() public {
        _approve(tokenA, 125 ether);
        _approve(tokenB, 50 ether);
        vm.prank(OWNER);
        kinn.deposit(address(tokenA), 100 ether);
        vm.prank(OWNER);
        kinn.deposit(address(tokenA), 25 ether);
        vm.prank(OWNER);
        kinn.deposit(address(tokenB), 50 ether);
        _assertEq(kinn.getTokenBalance(OWNER, address(tokenA)), 125 ether);
        _assertEq(kinn.getTokenBalance(OWNER, address(tokenB)), 50 ether);
        address[] memory tokens = kinn.getVaultTokens(OWNER);
        _assertEq(tokens.length, 2);
        _assertEq(tokens[0], address(tokenA));
        _assertEq(tokens[1], address(tokenB));
    }

    function testPartialAndFullWithdrawal() public {
        _deposit(tokenA, 100 ether);
        vm.expectEmit(true, true, false, true, address(kinn));
        emit AssetWithdrawn(OWNER, address(tokenA), 40 ether);
        vm.prank(OWNER);
        kinn.withdraw(address(tokenA), 40 ether);
        _assertEq(kinn.getTokenBalance(OWNER, address(tokenA)), 60 ether);
        _assertEq(tokenA.balanceOf(OWNER), 940 ether);
        vm.prank(OWNER);
        kinn.withdraw(address(tokenA), 60 ether);
        _assertEq(kinn.getTokenBalance(OWNER, address(tokenA)), 0);
        _assertEq(tokenA.balanceOf(OWNER), 1_000 ether);
    }

    function testUnauthorizedWithdrawalRejected() public {
        _deposit(tokenA, 100 ether);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultNotFound.selector, ATTACKER));
        vm.prank(ATTACKER);
        kinn.withdraw(address(tokenA), 1 ether);
        _assertEq(kinn.getTokenBalance(OWNER, address(tokenA)), 100 ether);
    }

    function testCannotWithdrawMoreThanBalance() public {
        _deposit(tokenA, 100 ether);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InsufficientBalance.selector, 100 ether, 101 ether));
        vm.prank(OWNER);
        kinn.withdraw(address(tokenA), 101 ether);
    }

    function testTransferFailureOnDepositReverts() public {
        tokenA.setFailTransfers(true);
        _approve(tokenA, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.TokenTransferFailed.selector, address(tokenA)));
        vm.prank(OWNER);
        kinn.deposit(address(tokenA), 1 ether);
        _assertEq(kinn.getTokenBalance(OWNER, address(tokenA)), 0);
    }

    function testTransferFailureOnWithdrawalPreservesAccounting() public {
        _deposit(tokenA, 100 ether);
        tokenA.setFailTransfers(true);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.TokenTransferFailed.selector, address(tokenA)));
        vm.prank(OWNER);
        kinn.withdraw(address(tokenA), 40 ether);
        _assertEq(kinn.getTokenBalance(OWNER, address(tokenA)), 100 ether);
    }

    function testZeroOperationsRejected() public {
        vm.expectRevert(KinnVault.InvalidAmount.selector);
        vm.prank(OWNER);
        kinn.deposit(address(tokenA), 0);
        vm.expectRevert(KinnVault.InvalidAmount.selector);
        vm.prank(OWNER);
        kinn.withdraw(address(tokenA), 0);
    }

    function testCannotCloseVaultWhileAssetsRemain() public {
        _deposit(tokenA, 100 ether);
        vm.prank(OWNER);
        kinn.withdraw(address(tokenA), 40 ether);

        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultHasAssets.selector, address(tokenA), 60 ether));
        vm.prank(OWNER);
        kinn.closeVault();
    }

    function testOwnerCanCloseEmptyVaultAndCreateFreshVault() public {
        _deposit(tokenA, 100 ether);
        vm.prank(OWNER);
        kinn.withdraw(address(tokenA), 100 ether);

        vm.expectEmit(true, false, false, false, address(kinn));
        emit VaultClosed(OWNER);
        vm.prank(OWNER);
        kinn.closeVault();
        _assertFalse(kinn.vaultExists(OWNER));

        address[] memory accounts = new address[](1);
        uint16[] memory allocations = new uint16[](1);
        accounts[0] = ALICE;
        allocations[0] = 10_000;
        vm.prank(OWNER);
        kinn.createVault(1 weeks, 1, accounts, allocations);
        _assertTrue(kinn.vaultExists(OWNER));
    }

    function _deposit(MockERC20 token, uint256 amount) private {
        _approve(token, amount);
        vm.prank(OWNER);
        kinn.deposit(address(token), amount);
    }

    function _approve(MockERC20 token, uint256 amount) private {
        vm.prank(OWNER);
        token.approve(address(kinn), amount);
    }

    function _assertEq(address left, address right) private pure {
        require(left == right, "address equality failed");
    }

    function _assertEq(uint256 left, uint256 right) private pure {
        require(left == right, "uint equality failed");
    }

    function _assertTrue(bool value) private pure {
        require(value, "assert true failed");
    }

    function _assertFalse(bool value) private pure {
        require(!value, "assert false failed");
    }
}
