// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {KinnVault} from "../src/KinnVault.sol";

interface VmCheckIn {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes calldata data) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
}

contract KinnVaultCheckInTest {
    VmCheckIn private constant vm = VmCheckIn(address(uint160(uint256(keccak256("hevm cheat code")))));
    KinnVault private kinn;
    address private constant OWNER = address(0xA11CE);
    address private constant ATTACKER = address(0xBAD);
    address private constant BENEFICIARY = address(0xB0B);
    uint256 private constant START = 1_000_000;

    event CheckedIn(address indexed owner, uint64 timestamp);

    function setUp() public {
        kinn = new KinnVault(0.0001 ether);
        vm.warp(START);
        address[] memory accounts = new address[](1);
        uint16[] memory allocations = new uint16[](1);
        accounts[0] = BENEFICIARY;
        allocations[0] = 10_000;
        vm.prank(OWNER);
        kinn.createVault(2 weeks, 3, accounts, allocations);
    }

    function testSuccessfulCheckInUpdatesTimestampAndEvent() public {
        uint256 timestamp = START + 2 weeks;
        vm.warp(timestamp);
        vm.expectEmit(true, false, false, true, address(kinn));
        emit CheckedIn(OWNER, uint64(timestamp));
        vm.prank(OWNER);
        kinn.checkIn();

        _assertEq(kinn.getVault(OWNER).lastCheckIn, timestamp);
        _assertEq(kinn.missedCheckIns(OWNER), 0);
    }

    function testEarlyAndRepeatedCheckInsResetFullClock() public {
        vm.warp(START + 1 days);
        vm.prank(OWNER);
        kinn.checkIn();
        _assertEq(kinn.nextExpectedCheckIn(OWNER), START + 1 days + 2 weeks);

        vm.warp(START + 2 days);
        vm.prank(OWNER);
        kinn.checkIn();
        _assertEq(kinn.nextExpectedCheckIn(OWNER), START + 2 days + 2 weeks);
    }

    function testMissedCheckInsUseCompleteIntervals() public {
        vm.warp(START + 2 weeks - 1);
        _assertEq(kinn.missedCheckIns(OWNER), 0);
        vm.warp(START + 2 weeks);
        _assertEq(kinn.missedCheckIns(OWNER), 1);
        vm.warp(START + 4 weeks);
        _assertEq(kinn.missedCheckIns(OWNER), 2);
    }

    function testMissedCheckInsCapsAtConfiguredMaximum() public {
        vm.warp(START + 20 weeks);
        _assertEq(kinn.missedCheckIns(OWNER), 3);
    }

    function testInheritanceEligibilityBoundary() public {
        vm.warp(START + 6 weeks - 1);
        _assertFalse(kinn.inheritanceEligible(OWNER));
        vm.warp(START + 6 weeks);
        _assertTrue(kinn.inheritanceEligible(OWNER));
        _assertEq(kinn.missedCheckIns(OWNER), 3);
    }

    function testCheckInAtEligibilityBoundaryResetsEligibility() public {
        vm.warp(START + 6 weeks);
        _assertTrue(kinn.inheritanceEligible(OWNER));
        vm.prank(OWNER);
        kinn.checkIn();
        _assertFalse(kinn.inheritanceEligible(OWNER));
        _assertEq(kinn.missedCheckIns(OWNER), 0);
    }

    function testUnauthorizedCheckInRejected() public {
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultNotFound.selector, ATTACKER));
        vm.prank(ATTACKER);
        kinn.checkIn();
        _assertEq(kinn.getVault(OWNER).lastCheckIn, START);
    }

    function testViewsRejectUnknownVault() public {
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultNotFound.selector, ATTACKER));
        kinn.nextExpectedCheckIn(ATTACKER);
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
