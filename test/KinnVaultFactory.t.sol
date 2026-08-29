// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.sol";
import {KinnVault} from "../src/KinnVault.sol";
import {KinnVaultFactory} from "../src/VaultFactory.sol";

contract KinnVaultFactoryTest is Base {
    function test_InitialState() public view {
        assertEq(address(vault.factory()), address(factory));
        assertEq(vault.owner(), owner);
        assertEq(vault.automationFeeWei(), FEE);
        assertEq(factory.automationFeeWei(), FEE);
    }

    function test_VaultRegisteredAndDiscoverable() public view {
        assertEq(factory.vaultOf(owner), address(vault));
        assertEq(factory.vaultCount(), 1);
        assertEq(factory.vaultAt(0), address(vault));
        assertTrue(factory.isVault(address(vault)));
        assertFalse(factory.isVault(address(0)));
        assertFalse(factory.isVault(owner));
        assertFalse(factory.isVault(address(token)));
    }

    function test_CreateVault_RevertIfAlreadyExists() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(KinnVaultFactory.VaultAlreadyExists.selector, owner));
        factory.createVault(INTERVAL, MAX_MISSED, _beneficiaryAccounts(), _equalHalves());
    }

    function test_CreateVault_MultipleOwnersEachGetTheirOwn() public {
        address owner2 = makeAddr("owner2");
        address owner3 = makeAddr("owner3");
        vm.prank(owner2);
        address v2 = factory.createVault(INTERVAL, MAX_MISSED, _beneficiaryAccounts(), _equalHalves());
        vm.prank(owner3);
        address v3 = factory.createVault(INTERVAL, MAX_MISSED, _beneficiaryAccounts(), _equalHalves());

        assertTrue(v2 != v3 && v2 != address(vault) && v3 != address(vault));
        assertEq(KinnVault(v2).owner(), owner2);
        assertEq(KinnVault(v3).owner(), owner3);
        assertEq(factory.vaultOf(owner2), v2);
        assertEq(factory.vaultOf(owner3), v3);
        assertEq(factory.vaultCount(), 3);
        assertTrue(factory.isVault(v2));
        assertTrue(factory.isVault(v3));
    }

    function test_VaultsAreIsolated() public {
        address owner2 = makeAddr("owner2");
        vm.deal(owner2, 10 ether);
        vm.startPrank(owner2);
        address v2 = factory.createVault(INTERVAL, MAX_MISSED, _beneficiaryAccounts(), _equalHalves());
        KinnVault(v2).depositETH{value: 1 ether}();
        vm.stopPrank();

        assertEq(address(vault).balance, 0);
        assertEq(v2.balance, 1 ether);
    }

    function test_CloseThenRecreate() public {
        vm.prank(owner);
        vault.closeVault();
        assertTrue(vault.closed());

        vm.startPrank(owner);
        address v2 = factory.createVault(INTERVAL, MAX_MISSED, _beneficiaryAccounts(), _equalHalves());
        vm.stopPrank();
        assertEq(factory.vaultOf(owner), v2);
        assertEq(factory.vaultCount(), 2);
    }

    function test_CreateVault_ValidatesConstructorArgs() public {
        address owner2 = makeAddr("owner2");
        address[] memory accounts = _beneficiaryAccounts();
        uint16[] memory allocs = _equalHalves();

        vm.startPrank(owner2);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidCheckInInterval.selector, uint64(0)));
        factory.createVault(0, MAX_MISSED, accounts, allocs);

        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidMaxMissedCheckIns.selector, uint8(0)));
        factory.createVault(INTERVAL, 0, accounts, allocs);

        uint16[] memory wrongSum = new uint16[](2);
        wrongSum[0] = 1;
        wrongSum[1] = 1;

        vm.expectRevert(abi.encodeWithSelector(KinnVault.InvalidTotalAllocation.selector, uint256(2)));
        factory.createVault(INTERVAL, MAX_MISSED, accounts, wrongSum);
        vm.stopPrank();
    }
}
