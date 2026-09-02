// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {KinnVault} from "../src/KinnVault.sol";

interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert(bytes4 selector) external;
    function warp(uint256 timestamp) external;
}

contract KinnVaultTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    KinnVault private vault;
    address private constant FACTORY = address(0xFac70);
    address private constant OWNER = address(0xA11CE);
    address private constant ALICE = address(0xB0B);
    address private constant BOB = address(0xCAFE);
    uint256 private constant FEE = 0.0001 ether;

    function setUp() public {
        vm.warp(1_000_000);
        vault = _newVault(2 weeks, 3);
    }

    // ---- creation ---------------------------------------------------------

    function testVaultOwnerAndImmutables() public view {
        assertEq(vault.owner(), OWNER);
        assertEq(vault.factory(), FACTORY);
        assertEq(vault.automationFeeWei(), FEE);
    }

    function testInitialStateAndTiming() public view {
        assertEq(uint256(vault.state()), uint256(KinnVault.InheritanceState.Active));
        assertFalse(vault.inheritanceTriggered());
        assertEq(vault.lastCheckIn(), 1_000_000);
        assertEq(vault.checkInInterval(), 2 weeks);
        assertEq(vault.maxMissedCheckIns(), 3);
        assertEq(vault.eligibilityDeadline(), 1_000_000 + 2 weeks * 3);
    }

    function testInitialBeneficiaries() public view {
        KinnVault.Beneficiary[] memory b = vault.getBeneficiaries();
        assertEq(b.length, 2);
        assertEq(b[0].account, ALICE);
        assertEq(b[0].allocationBps, 6_000);
        assertEq(b[1].account, BOB);
        assertEq(b[1].allocationBps, 4_000);
    }

    // ---- settings ---------------------------------------------------------

    function testOwnerUpdatesSettings() public {
        vm.prank(OWNER);
        vault.updateSettings(4 weeks, 5);
        assertEq(vault.checkInInterval(), 4 weeks);
        assertEq(vault.maxMissedCheckIns(), 5);
    }

    function testOwnerRejectsInvalidInterval() public {
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidCheckInInterval.selector, uint64(9 weeks + 1)));
        vm.prank(OWNER);
        vault.updateSettings(9 weeks + 1, 3);
    }

    function testOwnerRejectsInvalidMaxMissed() public {
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidMaxMissedCheckIns.selector, uint8(6)));
        vm.prank(OWNER);
        vault.updateSettings(1 weeks, 6);
    }

    function testNonOwnerCannotUpdateSettings() public {
        vm.expectRevert(abi.encodeWithSelector(KinnVault.NotOwner.selector, address(0xBEEF)));
        vm.prank(address(0xBEEF));
        vault.updateSettings(1 weeks, 1);
    }

    function testOwnerReplacesBeneficiaries() public {
        address[] memory a = new address[](1);
        uint16[] memory b = new uint16[](1);
        a[0] = BOB;
        b[0] = 10_000;
        vm.prank(OWNER);
        vault.updateBeneficiaries(a, b);
        KinnVault.Beneficiary[] memory out = vault.getBeneficiaries();
        assertEq(out.length, 1);
        assertEq(out[0].account, BOB);
        assertEq(out[0].allocationBps, 10_000);
    }

    function testNonOwnerCannotUpdateBeneficiaries() public {
        address[] memory a = new address[](1);
        uint16[] memory b = new uint16[](1);
        a[0] = address(0xBEEF);
        b[0] = 10_000;
        vm.expectRevert(abi.encodeWithSelector(KinnVault.NotOwner.selector, address(0xBEEF)));
        vm.prank(address(0xBEEF));
        vault.updateBeneficiaries(a, b);
    }

    // ---- all possible invalid configs rejected at construction ----------

    function testRejectsZeroInterval() public {
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidCheckInInterval.selector, uint64(0)));
        _newVault(0, 2);
    }

    function testRejectsZeroMaxMissed() public {
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidMaxMissedCheckIns.selector, uint8(0)));
        _newVault(1 weeks, 0);
    }

    function testRejectsEmptyBeneficiaryList() public {
        address[] memory a = new address[](0);
        uint16[] memory b = new uint16[](0);
        vm.expectRevert(KinnVault.BeneficiariesRequired.selector);
        new KinnVault(FACTORY, OWNER, 1 weeks, 2, a, b, FEE);
    }

    function testRejectsTooManyBeneficiaries() public {
        address[] memory a = new address[](51);
        uint16[] memory b = new uint16[](51);
        for (uint256 i; i < 51; ++i) {
            a[i] = address(uint160(1 + i));
            b[i] = 196;
        }
        vm.expectRevert(abi.encodeWithSelector(KinnVault.TooManyBeneficiaries.selector, 51, 50));
        new KinnVault(FACTORY, OWNER, 1 weeks, 2, a, b, FEE);
    }

    function testRejectsLengthMismatch() public {
        address[] memory a = new address[](2);
        uint16[] memory b = new uint16[](1);
        a[0] = ALICE;
        a[1] = BOB;
        b[0] = 10_000;
        vm.expectRevert(KinnVault.BeneficiaryArrayLengthMismatch.selector);
        new KinnVault(FACTORY, OWNER, 1 weeks, 2, a, b, FEE);
    }

    function testRejectsZeroAddressBeneficiary() public {
        address[] memory a = new address[](2);
        uint16[] memory b = new uint16[](2);
        a[0] = address(0);
        a[1] = BOB;
        b[0] = 5_000;
        b[1] = 5_000;
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidBeneficiary.selector, address(0)));
        new KinnVault(FACTORY, OWNER, 1 weeks, 2, a, b, FEE);
    }

    function testRejectsDuplicateBeneficiary() public {
        address[] memory a = new address[](2);
        uint16[] memory b = new uint16[](2);
        a[0] = ALICE;
        a[1] = ALICE;
        b[0] = 5_000;
        b[1] = 5_000;
        vm.expectRevert(abi.encodeWithSelector(KinnVault.DuplicateBeneficiary.selector, ALICE));
        new KinnVault(FACTORY, OWNER, 1 weeks, 2, a, b, FEE);
    }

    function testRejectsZeroAllocation() public {
        address[] memory a = new address[](2);
        uint16[] memory b = new uint16[](2);
        a[0] = ALICE;
        a[1] = BOB;
        b[0] = 0;
        b[1] = 10_000;
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidAllocation.selector, uint16(0)));
        new KinnVault(FACTORY, OWNER, 1 weeks, 2, a, b, FEE);
    }

    function testRejectsAllocationBelow100() public {
        address[] memory a = new address[](2);
        uint16[] memory b = new uint16[](2);
        a[0] = ALICE;
        a[1] = BOB;
        b[0] = 6_000;
        b[1] = 3_999;
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidTotalAllocation.selector, 9_999));
        new KinnVault(FACTORY, OWNER, 1 weeks, 2, a, b, FEE);
    }

    function testRejectsAllocationAbove100() public {
        address[] memory a = new address[](2);
        uint16[] memory b = new uint16[](2);
        a[0] = ALICE;
        a[1] = BOB;
        b[0] = 6_000;
        b[1] = 4_001;
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidTotalAllocation.selector, 10_001));
        new KinnVault(FACTORY, OWNER, 1 weeks, 2, a, b, FEE);
    }

    function testRejectsInvalidFactoryAddress() public {
        address[] memory a = new address[](1);
        uint16[] memory b = new uint16[](1);
        a[0] = ALICE;
        b[0] = 10_000;
        vm.expectRevert(KinnVault.InvalidAddress.selector);
        new KinnVault(address(0), OWNER, 1 weeks, 2, a, b, FEE);
    }

    // ---- helpers ----------------------------------------------------------

    function _newVault(uint64 interval, uint8 maxMissed) private returns (KinnVault) {
        address[] memory a = new address[](2);
        uint16[] memory b = new uint16[](2);
        a[0] = ALICE;
        a[1] = BOB;
        b[0] = 6_000;
        b[1] = 4_000;
        return new KinnVault(FACTORY, OWNER, interval, maxMissed, a, b, FEE);
    }

    function assertEq(address a, address b) private pure {
        require(a == b, "address equality");
    }

    function assertEq(uint256 a, uint256 b) private pure {
        require(a == b, "uint equality");
    }

    function assertFalse(bool value) private pure {
        require(!value, "expected false");
    }
}
