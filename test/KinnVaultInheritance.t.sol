// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {KinnVault} from "../src/KinnVault.sol";
import {MockERC20} from "./MockERC20.sol";

interface VmInheritance {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes calldata data) external;
    function expectRevert(bytes4 selector) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
}

contract KinnVaultInheritanceTest {
    VmInheritance private constant vm = VmInheritance(address(uint160(uint256(keccak256("hevm cheat code")))));
    KinnVault private kinn;
    MockERC20 private tokenA;
    MockERC20 private tokenB;
    address private constant OWNER = address(0xA11CE);
    address private constant EXECUTOR = address(0xE0);
    address private constant ALICE = address(0xB0B);
    address private constant BOB = address(0xCAFE);
    address private constant CHARLIE = address(0xC0DE);
    uint256 private constant START = 1_000_000;

    event InheritanceTriggered(address indexed owner, address indexed executor, uint64 timestamp);
    event InheritanceDistributed(
        address indexed owner, address indexed token, address indexed beneficiary, uint256 amount
    );
    event InheritanceTokenProcessed(address indexed owner, address indexed token, uint256 amount);

    function setUp() public {
        kinn = new KinnVault(0.0001 ether);
        tokenA = new MockERC20();
        tokenB = new MockERC20();
        vm.warp(START);
        address[] memory accounts = new address[](3);
        uint16[] memory allocations = new uint16[](3);
        accounts[0] = ALICE;
        accounts[1] = BOB;
        accounts[2] = CHARLIE;
        allocations[0] = 5_000;
        allocations[1] = 3_000;
        allocations[2] = 2_000;
        vm.prank(OWNER);
        kinn.createVault(1 weeks, 2, accounts, allocations);
        tokenA.mint(OWNER, 100_000);
        tokenB.mint(OWNER, 100_000);
    }

    function testCorrectDistributionToMultipleBeneficiaries() public {
        _deposit(tokenA, 10_000);
        _trigger();
        _assertEq(tokenA.balanceOf(ALICE), 5_000);
        _assertEq(tokenA.balanceOf(BOB), 3_000);
        _assertEq(tokenA.balanceOf(CHARLIE), 2_000);
        _assertEq(kinn.getTokenBalance(OWNER, address(tokenA)), 0);
        KinnVault.Vault memory vault = kinn.getVault(OWNER);
        _assertFalse(vault.active);
        _assertTrue(vault.inheritanceTriggered);
    }

    function testEmitsTriggerAndDistributionEvents() public {
        _deposit(tokenA, 100);
        vm.warp(START + 2 weeks);
        vm.expectEmit(true, true, false, true, address(kinn));
        emit InheritanceTriggered(OWNER, EXECUTOR, uint64(START + 2 weeks));
        vm.prank(EXECUTOR);
        kinn.triggerInheritance(OWNER);

        vm.expectEmit(true, true, false, true, address(kinn));
        emit InheritanceTokenProcessed(OWNER, address(tokenA), 100);
        vm.expectEmit(true, true, true, true, address(kinn));
        emit InheritanceDistributed(OWNER, address(tokenA), ALICE, 50);
        vm.expectEmit(true, true, true, true, address(kinn));
        emit InheritanceDistributed(OWNER, address(tokenA), BOB, 30);
        vm.expectEmit(true, true, true, true, address(kinn));
        emit InheritanceDistributed(OWNER, address(tokenA), CHARLIE, 20);
        vm.prank(EXECUTOR);
        kinn.distributeInheritanceToken(OWNER, address(tokenA));
    }

    function testDistributesMultipleAssets() public {
        _deposit(tokenA, 10_000);
        _deposit(tokenB, 20_000);
        _trigger();
        _assertEq(tokenA.balanceOf(ALICE), 5_000);
        _assertEq(tokenB.balanceOf(ALICE), 10_000);
        _assertEq(tokenB.balanceOf(BOB), 6_000);
        _assertEq(tokenB.balanceOf(CHARLIE), 4_000);
    }

    function testEarlyExecutionRejectedForAnyCaller() public {
        vm.warp(START + 2 weeks - 1);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InheritanceNotEligible.selector, OWNER));
        vm.prank(EXECUTOR);
        kinn.triggerInheritance(OWNER);
    }

    function testDoubleExecutionRejected() public {
        _deposit(tokenA, 10_000);
        _trigger();
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InheritanceAlreadyTriggered.selector, OWNER));
        vm.prank(EXECUTOR);
        kinn.triggerInheritance(OWNER);
    }

    function testZeroBalancesStillTriggerWithoutTransfers() public {
        vm.warp(START + 2 weeks);
        vm.prank(EXECUTOR);
        kinn.triggerInheritance(OWNER);
        KinnVault.Vault memory vault = kinn.getVault(OWNER);
        _assertFalse(vault.active);
        _assertTrue(vault.inheritanceTriggered);
    }

    function testRoundingRemainderGoesToLastBeneficiary() public {
        _deposit(tokenA, 101);
        _trigger();
        _assertEq(tokenA.balanceOf(ALICE), 50);
        _assertEq(tokenA.balanceOf(BOB), 30);
        _assertEq(tokenA.balanceOf(CHARLIE), 21);
        _assertEq(tokenA.balanceOf(address(kinn)), 0);
    }

    function testTransferFailuresStayPendingAndRetryAtCheckInInterval() public {
        _deposit(tokenA, 10_000);
        tokenA.setFailTransfers(true);
        _trigger();

        _assertEq(kinn.getPendingInheritance(OWNER, address(tokenA), ALICE), 5_000);
        _assertEq(kinn.getPendingInheritance(OWNER, address(tokenA), BOB), 3_000);
        _assertEq(kinn.getPendingInheritance(OWNER, address(tokenA), CHARLIE), 2_000);
        uint256 retryAt = START + 3 weeks;
        _assertEq(kinn.getNextDistributionRetry(OWNER, address(tokenA), ALICE), retryAt);

        tokenA.setFailTransfers(false);
        vm.warp(retryAt - 1);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.RetryNotReady.selector, retryAt));
        vm.prank(EXECUTOR);
        kinn.retryInheritanceDistribution(OWNER, address(tokenA), ALICE);

        vm.warp(retryAt);
        vm.prank(EXECUTOR);
        kinn.retryInheritanceDistribution(OWNER, address(tokenA), ALICE);
        _assertEq(tokenA.balanceOf(ALICE), 5_000);
        _assertEq(kinn.getPendingInheritance(OWNER, address(tokenA), ALICE), 0);
    }

    function testRepeatedTransferFailureReschedulesRetry() public {
        _deposit(tokenA, 10_000);
        tokenA.setFailTransfers(true);
        _trigger();
        uint256 firstRetry = START + 3 weeks;
        vm.warp(firstRetry);
        vm.prank(EXECUTOR);
        kinn.retryInheritanceDistribution(OWNER, address(tokenA), ALICE);
        _assertEq(kinn.getNextDistributionRetry(OWNER, address(tokenA), ALICE), START + 4 weeks);
        _assertEq(kinn.getPendingInheritance(OWNER, address(tokenA), ALICE), 5_000);
    }

    function testSuccessfulDistributionCannotBeRetried() public {
        _deposit(tokenA, 10_000);
        _trigger();
        vm.expectRevert(abi.encodeWithSelector(KinnVault.NoPendingInheritance.selector, OWNER, address(tokenA), ALICE));
        kinn.retryInheritanceDistribution(OWNER, address(tokenA), ALICE);
    }

    function testTokenCannotBeProcessedTwice() public {
        _deposit(tokenA, 10_000);
        _trigger();
        vm.expectRevert(
            abi.encodeWithSelector(KinnVault.InheritanceTokenAlreadyProcessed.selector, OWNER, address(tokenA))
        );
        kinn.distributeInheritanceToken(OWNER, address(tokenA));
    }

    function testFalseReturnAfterTokenMutationRollsBackAndRemainsPending() public {
        _deposit(tokenA, 10_000);
        tokenA.setFalseAfterTransfer(true);
        _trigger();

        _assertEq(tokenA.balanceOf(ALICE), 0);
        _assertEq(tokenA.balanceOf(address(kinn)), 10_000);
        _assertEq(kinn.getPendingInheritance(OWNER, address(tokenA), ALICE), 5_000);

        tokenA.setFalseAfterTransfer(false);
        vm.warp(START + 3 weeks);
        kinn.retryInheritanceDistribution(OWNER, address(tokenA), ALICE);
        _assertEq(tokenA.balanceOf(ALICE), 5_000);
    }

    function testOnlyContractCanUseIsolatedTransferEntryPoint() public {
        vm.expectRevert(KinnVault.OnlySelf.selector);
        kinn.attemptTokenTransfer(address(tokenA), ALICE, 1);
    }

    function testOwnerOperationsRejectedAfterTrigger() public {
        _deposit(tokenA, 10_000);
        _trigger();
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultInactive.selector, OWNER));
        vm.prank(OWNER);
        kinn.withdraw(address(tokenA), 1);
    }

    function _deposit(MockERC20 token, uint256 amount) private {
        vm.prank(OWNER);
        token.approve(address(kinn), amount);
        vm.prank(OWNER);
        kinn.deposit(address(token), amount);
    }

    function _trigger() private {
        vm.warp(START + 2 weeks);
        vm.prank(EXECUTOR);
        kinn.triggerInheritance(OWNER);
        if (kinn.getTokenBalance(OWNER, address(tokenA)) != 0) {
            vm.prank(EXECUTOR);
            kinn.distributeInheritanceToken(OWNER, address(tokenA));
        }
        if (kinn.getTokenBalance(OWNER, address(tokenB)) != 0) {
            vm.prank(EXECUTOR);
            kinn.distributeInheritanceToken(OWNER, address(tokenB));
        }
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
