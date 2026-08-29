// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.sol";
import {KinnVault} from "../src/KinnVault.sol";

contract KinnVaultConfigTest is Base {
    function test_InitialConfig() public view {
        assertEq(vault.checkInInterval(), INTERVAL);
        assertEq(vault.maxMissedCheckIns(), MAX_MISSED);
        assertEq(vault.lastCheckIn(), block.timestamp);
        assertFalse(vault.inheritanceTriggered());
        assertFalse(vault.closed());

        KinnVault.Beneficiary[] memory bens = vault.getBeneficiaries();
        assertEq(bens.length, 2);
        assertEq(bens[0].account, beneficiaryA);
        assertEq(bens[0].allocationBps, 5000);
        assertEq(bens[1].account, beneficiaryB);
        assertEq(bens[1].allocationBps, 5000);
    }

    // ---- Authorization ----

    function test_OwnerActions_RevertIfNotOwner() public {
        vm.deal(keeper, 1 ether);
        vm.startPrank(keeper);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.NotOwner.selector, keeper));
        vault.updateSettings(INTERVAL, MAX_MISSED);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.NotOwner.selector, keeper));
        vault.updateBeneficiaries(_beneficiaryAccounts(), _equalHalves());
        vm.expectRevert(abi.encodeWithSelector(KinnVault.NotOwner.selector, keeper));
        vault.checkIn();
        vm.expectRevert(abi.encodeWithSelector(KinnVault.NotOwner.selector, keeper));
        vault.depositETH{value: 1 ether}();
        vm.expectRevert(abi.encodeWithSelector(KinnVault.NotOwner.selector, keeper));
        vault.closeVault();
        vm.stopPrank();
    }

    function test_FactoryCannotActOnVault() public {
        vm.startPrank(address(factory));
        vm.expectRevert(abi.encodeWithSelector(KinnVault.NotOwner.selector, address(factory)));
        vault.withdraw(ETH_SENTINEL, 1 ether);
        vm.stopPrank();
    }

    // ---- Settings ----

    function test_UpdateSettings() public {
        vm.prank(owner);
        vault.updateSettings(2 weeks, 5);
        assertEq(vault.checkInInterval(), 2 weeks);
        assertEq(vault.maxMissedCheckIns(), 5);
    }

    function test_UpdateSettings_Validation() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidCheckInInterval.selector, uint64(0)));
        vault.updateSettings(0, MAX_MISSED);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidCheckInInterval.selector, uint64(9 weeks + 1)));
        vault.updateSettings(9 weeks + 1, MAX_MISSED);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidMaxMissedCheckIns.selector, uint8(0)));
        vault.updateSettings(INTERVAL, 0);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidMaxMissedCheckIns.selector, uint8(6)));
        vault.updateSettings(INTERVAL, 6);
        vm.stopPrank();
    }

    // ---- Beneficiaries ----

    function test_UpdateBeneficiaries() public {
        address[] memory accounts = new address[](1);
        accounts[0] = beneficiaryB;
        uint16[] memory allocations = new uint16[](1);
        allocations[0] = 10_000;

        vm.prank(owner);
        vault.updateBeneficiaries(accounts, allocations);

        KinnVault.Beneficiary[] memory bens = vault.getBeneficiaries();
        assertEq(bens.length, 1);
        assertEq(bens[0].account, beneficiaryB);
        assertEq(bens[0].allocationBps, 10_000);
    }

    function test_UpdateBeneficiaries_Validation() public {
        address[] memory accounts = new address[](2);
        accounts[0] = beneficiaryA;
        accounts[1] = beneficiaryB;
        uint16[] memory badSum = new uint16[](2);
        badSum[0] = 5000;
        badSum[1] = 4000;
        uint16[] memory withZero = new uint16[](2);
        withZero[0] = 0;
        withZero[1] = 10_000;
        uint16[] memory ok = new uint16[](2);
        ok[0] = 4000;
        ok[1] = 6000;

        vm.startPrank(owner);
        vm.expectRevert(KinnVault.BeneficiariesRequired.selector);
        vault.updateBeneficiaries(new address[](0), new uint16[](0));
        vm.expectRevert(KinnVault.BeneficiaryArrayLengthMismatch.selector);
        vault.updateBeneficiaries(accounts, new uint16[](1));
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidTotalAllocation.selector, 9000));
        vault.updateBeneficiaries(accounts, badSum);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidAllocation.selector, 0));
        vault.updateBeneficiaries(accounts, withZero);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidBeneficiary.selector, address(0)));
        accounts[0] = address(0);
        vault.updateBeneficiaries(accounts, ok);
        accounts[0] = beneficiaryB;
        vm.expectRevert(abi.encodeWithSelector(KinnVault.DuplicateBeneficiary.selector, beneficiaryB));
        vault.updateBeneficiaries(accounts, ok);
        vm.stopPrank();
    }
    function test_MaxFiftyBeneficiaries() public {
        address[] memory accounts = new address[](50);
        uint16[] memory allocations = new uint16[](50);
        for (uint256 i; i < 50; ++i) {
            accounts[i] = makeAddr(string(abi.encodePacked("ben", i)));
            allocations[i] = 200; // 50 * 200 = 10000
        }
        vm.prank(owner);
        vault.updateBeneficiaries(accounts, allocations);
        assertEq(vault.getBeneficiaries().length, 50);

        address[] memory tooMany = new address[](51);
        uint16[] memory tooManyAllocs = new uint16[](51);
        for (uint256 i; i < 51; ++i) {
            tooMany[i] = accounts[i % 50];
            tooManyAllocs[i] = 1;
        }
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.TooManyBeneficiaries.selector, 51, 50));
        vault.updateBeneficiaries(tooMany, tooManyAllocs);
    }

    // ---- Check-in ----

    function test_CheckInResetsClock() public {
        vm.warp(block.timestamp + 2 days);
        vm.prank(owner);
        vault.checkIn();
        assertEq(vault.lastCheckIn(), block.timestamp);
        assertEq(vault.nextExpectedCheckIn(), block.timestamp + INTERVAL);
        assertEq(vault.missedCheckIns(), 0);
    }

    function test_CheckIn_RevertIfInactive() public {
        _trigger();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultInactive.selector, owner));
        vault.checkIn();
    }

    function test_CheckIn_RevertIfClosed() public {
        vm.prank(owner);
        vault.closeVault();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultInactive.selector, owner));
        vault.checkIn();
    }

    // ---- Close ----

    function test_CloseVault_Empty() public {
        vm.prank(owner);
        vault.closeVault();
        assertTrue(vault.closed());
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Closed));
        assertEq(vault.getBeneficiaries().length, 0);
    }

    function test_CloseVault_RevertIfHasAssets() public {
        _depositToken(100 ether);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(KinnVault.VaultHasAssets.selector, address(token), 100 ether)
        );
        vault.closeVault();
    }

    function test_CloseVault_RevertIfHasETH() public {
        _depositETH(1 ether);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(KinnVault.VaultHasAssets.selector, ETH_SENTINEL, 1 ether)
        );
        vault.closeVault();
    }

    function test_CloseVault_RevertIfHasReserve() public {
        _topUpReserve(0.5 ether);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultHasAutomationReserve.selector, 0.5 ether));
        vault.closeVault();
    }

    function test_CloseVault_RevertIfTriggered() public {
        _trigger();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultInactive.selector, owner));
        vault.closeVault();
    }

    function test_ClosedVault_RejectsOwnerActions() public {
        vm.prank(owner);
        vault.closeVault();
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultIsClosed.selector, owner));
        vault.updateSettings(INTERVAL, MAX_MISSED);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultInactive.selector, owner));
        vault.checkIn();
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultIsClosed.selector, owner));
        vault.depositETH{value: 1 ether}();
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultIsClosed.selector, owner));
        vault.triggerInheritance();
        vm.stopPrank();
    }
}
