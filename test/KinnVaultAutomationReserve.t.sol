// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {KinnVault} from "../src/KinnVault.sol";
import {MockERC20} from "./MockERC20.sol";

interface VmReserve {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function deal(address account, uint256 balance) external;
    function expectRevert(bytes calldata data) external;
    function expectRevert(bytes4 selector) external;
}

contract RejectingExecutor {
    function trigger(KinnVault kinn, address owner) external {
        kinn.triggerInheritance(owner);
    }

    receive() external payable {
        revert("reject ETH");
    }
}

contract KinnVaultAutomationReserveTest {
    VmReserve private constant vm = VmReserve(address(uint160(uint256(keccak256("hevm cheat code")))));
    KinnVault private kinn;
    MockERC20 private token;
    address private constant OWNER = address(0xA11CE);
    address private constant EXECUTOR = address(0xE0);
    address private constant BENEFICIARY = address(0xB0B);
    uint256 private constant START = 1_000_000;

    function setUp() public {
        kinn = new KinnVault(0.0001 ether);
        token = new MockERC20();
        vm.deal(OWNER, 10 ether);
        vm.deal(EXECUTOR, 1 ether);
        vm.warp(START);
    }

    function testCreateVaultWithReserveAndTopUp() public {
        _createVault(0.001 ether);
        _assertEq(kinn.automationReserve(OWNER), 0.001 ether);
        vm.prank(OWNER);
        kinn.topUpAutomationReserve{value: 0.002 ether}();
        _assertEq(kinn.automationReserve(OWNER), 0.003 ether);
        _assertEq(address(kinn).balance, 0.003 ether);
    }

    function testZeroTopUpRejected() public {
        _createVault(0);
        vm.expectRevert(KinnVault.InvalidAmount.selector);
        vm.prank(OWNER);
        kinn.topUpAutomationReserve();
    }

    function testOwnerCanWithdrawReserveWhileVaultIsActive() public {
        _createVault(0.001 ether);
        uint256 beforeBalance = OWNER.balance;
        vm.prank(OWNER);
        kinn.withdrawAutomationReserve(0.0004 ether);
        _assertEq(kinn.automationReserve(OWNER), 0.0006 ether);
        _assertEq(OWNER.balance, beforeBalance + 0.0004 ether);
    }

    function testCannotCloseVaultUntilReserveIsWithdrawn() public {
        _createVault(0.001 ether);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultHasAutomationReserve.selector, 0.001 ether));
        vm.prank(OWNER);
        kinn.closeVault();

        vm.prank(OWNER);
        kinn.withdrawAutomationReserve(0.001 ether);
        vm.prank(OWNER);
        kinn.closeVault();
        _assertFalse(kinn.vaultExists(OWNER));
    }

    function testValidTriggerReimbursesExecutor() public {
        _createVault(0.001 ether);
        uint256 executorBefore = EXECUTOR.balance;
        vm.warp(START + 2 weeks);
        vm.prank(EXECUTOR);
        kinn.triggerInheritance(OWNER);
        _assertEq(EXECUTOR.balance, executorBefore + kinn.automationFeeWei());
        _assertEq(kinn.automationReserve(OWNER), 0.001 ether - kinn.automationFeeWei());
    }

    function testSmallReservePaysOnlyRemainingAmount() public {
        _createVault(1 wei);
        uint256 executorBefore = EXECUTOR.balance;
        vm.warp(START + 2 weeks);
        vm.prank(EXECUTOR);
        kinn.triggerInheritance(OWNER);
        _assertEq(EXECUTOR.balance, executorBefore + 1 wei);
        _assertEq(kinn.automationReserve(OWNER), 0);
    }

    function testZeroReserveDoesNotBlockInheritance() public {
        _createVault(0);
        vm.warp(START + 2 weeks);
        vm.prank(EXECUTOR);
        kinn.triggerInheritance(OWNER);
        _assertTrue(kinn.getVault(OWNER).inheritanceTriggered);
    }

    function testRejectedFeeDoesNotRevertTriggerOrConsumeReserve() public {
        _createVault(0.001 ether);
        RejectingExecutor rejecting = new RejectingExecutor();
        vm.warp(START + 2 weeks);
        rejecting.trigger(kinn, OWNER);
        _assertTrue(kinn.getVault(OWNER).inheritanceTriggered);
        _assertEq(kinn.automationReserve(OWNER), 0.001 ether);
    }

    function testReserveCannotBeWithdrawnAfterInheritanceTriggers() public {
        _createVault(0.001 ether);
        vm.warp(START + 2 weeks);
        vm.prank(EXECUTOR);
        kinn.triggerInheritance(OWNER);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultInactive.selector, OWNER));
        vm.prank(OWNER);
        kinn.withdrawAutomationReserve(1 wei);
    }

    function testCompletedReserveCanBeClaimedByMaintenanceCaller() public {
        _createVault(0.001 ether);
        vm.warp(START + 2 weeks);
        vm.prank(EXECUTOR);
        kinn.triggerInheritance(OWNER);
        uint256 executorBefore = EXECUTOR.balance;
        vm.prank(EXECUTOR);
        kinn.claimCompletedAutomationReserve(OWNER);
        _assertEq(EXECUTOR.balance, executorBefore + 0.001 ether - kinn.automationFeeWei());
        _assertEq(kinn.automationReserve(OWNER), 0);
    }

    function testReserveCannotBeClaimedWhileInheritanceWorkRemains() public {
        _createVault(0.001 ether);
        token.mint(OWNER, 1_000);
        vm.prank(OWNER);
        token.approve(address(kinn), 1_000);
        vm.prank(OWNER);
        kinn.deposit(address(token), 1_000);
        vm.warp(START + 2 weeks);
        vm.prank(EXECUTOR);
        kinn.triggerInheritance(OWNER);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InheritanceIncomplete.selector, OWNER));
        vm.prank(EXECUTOR);
        kinn.claimCompletedAutomationReserve(OWNER);
    }

    function testTriggerDistributionAndRetryAreEachReimbursed() public {
        _createVault(0.001 ether);
        token.mint(OWNER, 1_000);
        vm.prank(OWNER);
        token.approve(address(kinn), 1_000);
        vm.prank(OWNER);
        kinn.deposit(address(token), 1_000);

        uint256 executorBefore = EXECUTOR.balance;
        vm.warp(START + 2 weeks);
        vm.prank(EXECUTOR);
        kinn.triggerInheritance(OWNER);

        token.setFailTransfers(true);
        vm.prank(EXECUTOR);
        kinn.distributeInheritanceToken(OWNER, address(token));
        token.setFailTransfers(false);
        vm.warp(START + 3 weeks);
        vm.prank(EXECUTOR);
        kinn.retryInheritanceDistribution(OWNER, address(token), BENEFICIARY);

        uint256 totalFees = kinn.automationFeeWei() * 3;
        _assertEq(EXECUTOR.balance, executorBefore + totalFees);
        _assertEq(kinn.automationReserve(OWNER), 0.001 ether - totalFees);
    }

    function _createVault(uint256 reserve) private {
        address[] memory accounts = new address[](1);
        uint16[] memory allocations = new uint16[](1);
        accounts[0] = BENEFICIARY;
        allocations[0] = 10_000;
        vm.prank(OWNER);
        kinn.createVault{value: reserve}(1 weeks, 2, accounts, allocations);
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
