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

    KinnVault private kinn;

    address private constant OWNER = address(0xA11CE);
    address private constant ATTACKER = address(0xBAD);
    address private constant ALICE = address(0xB0B);
    address private constant BOB = address(0xCAFE);

    function setUp() public {
        kinn = new KinnVault(0.0001 ether);
    }

    function testCreateVault() public {
        vm.warp(1_000_000);
        _createDefaultVault();

        KinnVault.Vault memory vault = kinn.getVault(OWNER);
        _assertEq(vault.owner, OWNER);
        _assertEq(vault.lastCheckIn, 1_000_000);
        _assertEq(vault.checkInInterval, 2 weeks);
        _assertEq(vault.maxMissedCheckIns, 3);
        _assertTrue(vault.active);
        _assertFalse(vault.inheritanceTriggered);
    }

    function testCannotCreateDuplicateVault() public {
        _createDefaultVault();
        (address[] memory accounts, uint16[] memory allocations) = _defaultBeneficiaries();

        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultAlreadyExists.selector, OWNER));
        vm.prank(OWNER);
        kinn.createVault(1 weeks, 2, accounts, allocations);
    }

    function testCreatesMultipleBeneficiariesWithExactTotal() public {
        _createDefaultVault();
        KinnVault.Beneficiary[] memory result = kinn.getBeneficiaries(OWNER);

        _assertEq(result.length, 2);
        _assertEq(result[0].account, ALICE);
        _assertEq(result[0].allocationBps, 6_000);
        _assertEq(result[1].account, BOB);
        _assertEq(result[1].allocationBps, 4_000);
    }

    function testRejectsAllocationBelowOneHundredPercent() public {
        (address[] memory accounts, uint16[] memory allocations) = _defaultBeneficiaries();
        allocations[1] = 3_999;

        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidTotalAllocation.selector, 9_999));
        vm.prank(OWNER);
        kinn.createVault(2 weeks, 3, accounts, allocations);
    }

    function testRejectsAllocationAboveOneHundredPercent() public {
        (address[] memory accounts, uint16[] memory allocations) = _defaultBeneficiaries();
        allocations[1] = 4_001;

        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidTotalAllocation.selector, 10_001));
        vm.prank(OWNER);
        kinn.createVault(2 weeks, 3, accounts, allocations);
    }

    function testRejectsDuplicateBeneficiary() public {
        (address[] memory accounts, uint16[] memory allocations) = _defaultBeneficiaries();
        accounts[1] = ALICE;

        vm.expectRevert(abi.encodeWithSelector(KinnVault.DuplicateBeneficiary.selector, ALICE));
        vm.prank(OWNER);
        kinn.createVault(2 weeks, 3, accounts, allocations);
    }

    function testRejectsZeroAddressBeneficiary() public {
        (address[] memory accounts, uint16[] memory allocations) = _defaultBeneficiaries();
        accounts[0] = address(0);

        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidBeneficiary.selector, address(0)));
        vm.prank(OWNER);
        kinn.createVault(2 weeks, 3, accounts, allocations);
    }

    function testAllowsOwnerAsBeneficiary() public {
        address[] memory accounts = new address[](1);
        uint16[] memory allocations = new uint16[](1);
        accounts[0] = OWNER;
        allocations[0] = 10_000;

        vm.prank(OWNER);
        kinn.createVault(2 weeks, 3, accounts, allocations);

        KinnVault.Beneficiary[] memory result = kinn.getBeneficiaries(OWNER);
        _assertEq(result[0].account, OWNER);
    }

    function testRejectsEmptyBeneficiaryList() public {
        address[] memory accounts = new address[](0);
        uint16[] memory allocations = new uint16[](0);

        vm.expectRevert(KinnVault.BeneficiariesRequired.selector);
        vm.prank(OWNER);
        kinn.createVault(2 weeks, 3, accounts, allocations);
    }

    function testRejectsMoreThanMaximumBeneficiaries() public {
        uint256 count = uint256(kinn.MAX_BENEFICIARIES()) + 1;
        address[] memory accounts = new address[](count);
        uint16[] memory allocations = new uint16[](count);

        vm.expectRevert(abi.encodeWithSelector(KinnVault.TooManyBeneficiaries.selector, count, 50));
        vm.prank(OWNER);
        kinn.createVault(2 weeks, 3, accounts, allocations);
    }

    function testRejectsBeneficiaryArrayLengthMismatch() public {
        address[] memory accounts = new address[](1);
        uint16[] memory allocations = new uint16[](0);
        accounts[0] = ALICE;

        vm.expectRevert(KinnVault.BeneficiaryArrayLengthMismatch.selector);
        vm.prank(OWNER);
        kinn.createVault(2 weeks, 3, accounts, allocations);
    }

    function testRejectsZeroBeneficiaryAllocation() public {
        (address[] memory accounts, uint16[] memory allocations) = _defaultBeneficiaries();
        allocations[0] = 0;
        allocations[1] = 10_000;

        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidAllocation.selector, 0));
        vm.prank(OWNER);
        kinn.createVault(2 weeks, 3, accounts, allocations);
    }

    function testRejectsZeroCheckInInterval() public {
        (address[] memory accounts, uint16[] memory allocations) = _defaultBeneficiaries();

        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidCheckInInterval.selector, 0));
        vm.prank(OWNER);
        kinn.createVault(0, 3, accounts, allocations);
    }

    function testAcceptsMaximumCheckInInterval() public {
        (address[] memory accounts, uint16[] memory allocations) = _defaultBeneficiaries();
        vm.prank(OWNER);
        kinn.createVault(9 weeks, 3, accounts, allocations);

        _assertEq(kinn.getVault(OWNER).checkInInterval, 9 weeks);
    }

    function testRejectsCheckInIntervalAboveNineWeeks() public {
        (address[] memory accounts, uint16[] memory allocations) = _defaultBeneficiaries();

        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidCheckInInterval.selector, uint64(9 weeks + 1)));
        vm.prank(OWNER);
        kinn.createVault(9 weeks + 1, 3, accounts, allocations);
    }

    function testRejectsZeroMaximumMissedCheckIns() public {
        (address[] memory accounts, uint16[] memory allocations) = _defaultBeneficiaries();

        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidMaxMissedCheckIns.selector, 0));
        vm.prank(OWNER);
        kinn.createVault(2 weeks, 0, accounts, allocations);
    }

    function testAcceptsMaximumMissedCheckIns() public {
        (address[] memory accounts, uint16[] memory allocations) = _defaultBeneficiaries();
        vm.prank(OWNER);
        kinn.createVault(2 weeks, 5, accounts, allocations);

        _assertEq(kinn.getVault(OWNER).maxMissedCheckIns, 5);
    }

    function testRejectsMaximumMissedCheckInsAboveFive() public {
        (address[] memory accounts, uint16[] memory allocations) = _defaultBeneficiaries();

        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidMaxMissedCheckIns.selector, 6));
        vm.prank(OWNER);
        kinn.createVault(2 weeks, 6, accounts, allocations);
    }

    function testOwnerCanUpdateSettings() public {
        _createDefaultVault();

        vm.prank(OWNER);
        kinn.updateSettings(4 weeks, 5);

        KinnVault.Vault memory vault = kinn.getVault(OWNER);
        _assertEq(vault.checkInInterval, 4 weeks);
        _assertEq(vault.maxMissedCheckIns, 5);
    }

    function testOwnerCannotUpdateToInvalidSettings() public {
        _createDefaultVault();

        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidCheckInInterval.selector, uint64(9 weeks + 1)));
        vm.prank(OWNER);
        kinn.updateSettings(9 weeks + 1, 3);
    }

    function testOwnerCanReplaceBeneficiaries() public {
        _createDefaultVault();
        address[] memory accounts = new address[](1);
        uint16[] memory allocations = new uint16[](1);
        accounts[0] = BOB;
        allocations[0] = 10_000;

        vm.prank(OWNER);
        kinn.updateBeneficiaries(accounts, allocations);

        KinnVault.Beneficiary[] memory result = kinn.getBeneficiaries(OWNER);
        _assertEq(result.length, 1);
        _assertEq(result[0].account, BOB);
        _assertEq(result[0].allocationBps, 10_000);
    }

    function testUnauthorizedCallerCannotChangeOwnerSettings() public {
        _createDefaultVault();

        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultNotFound.selector, ATTACKER));
        vm.prank(ATTACKER);
        kinn.updateSettings(1 weeks, 1);

        KinnVault.Vault memory vault = kinn.getVault(OWNER);
        _assertEq(vault.checkInInterval, 2 weeks);
        _assertEq(vault.maxMissedCheckIns, 3);
    }

    function testUnauthorizedCallerCannotChangeOwnerBeneficiaries() public {
        _createDefaultVault();
        address[] memory accounts = new address[](1);
        uint16[] memory allocations = new uint16[](1);
        accounts[0] = ATTACKER;
        allocations[0] = 10_000;

        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultNotFound.selector, ATTACKER));
        vm.prank(ATTACKER);
        kinn.updateBeneficiaries(accounts, allocations);

        KinnVault.Beneficiary[] memory result = kinn.getBeneficiaries(OWNER);
        _assertEq(result[0].account, ALICE);
        _assertEq(result[1].account, BOB);
    }

    function _createDefaultVault() private {
        (address[] memory accounts, uint16[] memory allocations) = _defaultBeneficiaries();
        vm.prank(OWNER);
        kinn.createVault(2 weeks, 3, accounts, allocations);
    }

    function _defaultBeneficiaries() private pure returns (address[] memory accounts, uint16[] memory allocations) {
        accounts = new address[](2);
        allocations = new uint16[](2);
        accounts[0] = ALICE;
        accounts[1] = BOB;
        allocations[0] = 6_000;
        allocations[1] = 4_000;
    }

    function _assertTrue(bool value) private pure {
        require(value, "assert true failed");
    }

    function _assertFalse(bool value) private pure {
        require(!value, "assert false failed");
    }

    function _assertEq(address left, address right) private pure {
        require(left == right, "address equality failed");
    }

    function _assertEq(uint256 left, uint256 right) private pure {
        require(left == right, "uint equality failed");
    }
}
