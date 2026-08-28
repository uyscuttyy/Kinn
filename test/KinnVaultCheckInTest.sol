// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {KinnVault} from "../src/KinnVault.sol";

interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert(bytes4 selector) external;
    function warp(uint256 timestamp) external;
}

contract KinnVaultCheckInTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    KinnVault private vault;
    address private constant FACTORY = address(0xFac70);
    address private constant OWNER = address(0xA11CE);
    address private constant ALICE = address(0xB0B);
    address private constant BOB = address(0xCAFE);
    uint256 private constant FEE = 0.0001 ether;
    uint256 private constant START = 1_000_000;

    function setUp() public {
        vm.warp(START);
        vault = _newVault(1 weeks, 3);
    }

    // ---- derived state machine -------------------------------------------

    function testStartsActive() public view {
        assertEq(uint256(vault.state()), uint256(KinnVault.InheritanceState.Active));
    }

    function testMissedStateAfterFirstDeadline() public {
        vm.warp(START + 1 weeks + 1);
        assertEq(uint256(vault.state()), uint256(KinnVault.InheritanceState.Missed));
        assertEq(vault.missedCheckIns(), 1);
    }

    function testMissedCountAccrues() public {
        vm.warp(START + 2 weeks + 1);
        assertEq(vault.missedCheckIns(), 2);
        vm.warp(START + 3 weeks + 1);
        assertEq(vault.missedCheckIns(), 3);
    }

    function testMissedCountCappedAtMax() public {
        vm.warp(START + 10 weeks);
        assertEq(vault.missedCheckIns(), 3);
    }

    function testEligibleAtExactDeadline() public {
        vm.warp(START + 3 weeks);
        assertEq(uint256(vault.state()), uint256(KinnVault.InheritanceState.Eligible));
        assertTrue(vault.inheritanceEligible());
    }

    function testNotEligibleBeforeDeadline() public {
        vm.warp(START + 3 weeks - 1);
        assertFalse(vault.inheritanceEligible());
    }

    // ---- check-in resets the full timer -----------------------------------

    function testCheckInResetsTimer() public {
        vm.warp(START + 1 weeks);
        vm.prank(OWNER);
        vault.checkIn();
        assertEq(vault.lastCheckIn(), START + 1 weeks);
        assertEq(vault.nextExpectedCheckIn(), START + 1 weeks + 1 weeks);
    }

    function testCheckInCancelsMissedAndEligibleState() public {
        vm.warp(START + 3 weeks);
        assertTrue(vault.inheritanceEligible());
        vm.prank(OWNER);
        vault.checkIn();
        assertEq(uint256(vault.state()), uint256(KinnVault.InheritanceState.Active));
        assertEq(vault.missedCheckIns(), 0);
        assertFalse(vault.inheritanceEligible());
    }

    function testCheckInCancelsEligibilityBeforeTrigger() public {
        vm.warp(START + 3 weeks);
        vm.prank(OWNER);
        vault.checkIn();
        vm.warp(START + 3 weeks + 3 weeks - 1);
        assertFalse(vault.inheritanceEligible());
    }

    function testOnlyOwnerCanCheckIn() public {
        vm.expectRevert(abi.encodeWithSelector(KinnVault.NotOwner.selector, ALICE));
        vm.prank(ALICE);
        vault.checkIn();
    }

    // ---- close -----------------------------------------------------------

    function testOwnerCanCloseEmptyVault() public {
        vm.prank(OWNER);
        vault.closeVault();
        assertEq(uint256(vault.state()), uint256(KinnVault.InheritanceState.Closed));
        assertTrue(vault.closed());
    }

    function testCannotCheckInAfterClose() public {
        vm.prank(OWNER);
        vault.closeVault();
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultInactive.selector, OWNER));
        vm.prank(OWNER);
        vault.checkIn();
    }

    function testCannotCheckInAfterTrigger() public {
        vault = _newVault(60, 1);
        vm.warp(START + 60);
        vault.triggerInheritance();
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultInactive.selector, OWNER));
        vm.prank(OWNER);
        vault.checkIn();
    }

    // ---- helpers ---------------------------------------------------------

    function _newVault(uint64 interval, uint8 maxMissed) private returns (KinnVault) {
        address[] memory a = new address[](2);
        uint16[] memory b = new uint16[](2);
        a[0] = ALICE;
        a[1] = BOB;
        b[0] = 6_000;
        b[1] = 4_000;
        return new KinnVault(FACTORY, OWNER, interval, maxMissed, a, b, FEE);
    }

    function assertTrue(bool value) private pure {
        require(value, "expected true");
    }

    function assertFalse(bool value) private pure {
        require(!value, "expected false");
    }

    function assertEq(uint256 a, uint256 b) private pure {
        require(a == b, "uint equality");
    }
}