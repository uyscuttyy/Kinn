// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {KinnVault} from "../src/KinnVault.sol";
import {MockERC20} from "./MockERC20.sol";

interface VmE2E {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function deal(address account, uint256 balance) external;
    function expectRevert(bytes calldata data) external;
}

contract KinnEndToEndTest {
    VmE2E private constant vm = VmE2E(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant OWNER = address(0xA11CE);
    address private constant RELAYER = address(0xE0);
    address private constant ALICE = address(0xB0B);
    address private constant BOB = address(0xCAFE);
    address private constant CHARLIE = address(0xC0DE);
    uint256 private constant START = 1_000_000;

    function testCompleteKinnLifecycle() public {
        KinnVault kinn = new KinnVault(0.0001 ether);
        MockERC20 rwaToken = new MockERC20();
        vm.deal(OWNER, 1 ether);
        vm.deal(RELAYER, 1 ether);
        vm.warp(START);

        address[] memory beneficiaries = new address[](3);
        uint16[] memory allocations = new uint16[](3);
        beneficiaries[0] = ALICE;
        beneficiaries[1] = BOB;
        beneficiaries[2] = CHARLIE;
        allocations[0] = 5_000;
        allocations[1] = 3_000;
        allocations[2] = 2_000;

        vm.prank(OWNER);
        kinn.createVault{value: 0.001 ether}(2 weeks, 3, beneficiaries, allocations);
        _assertEq(kinn.automationReserve(OWNER), 0.001 ether);

        rwaToken.mint(OWNER, 10_000);
        vm.prank(OWNER);
        rwaToken.approve(address(kinn), 10_000);
        vm.prank(OWNER);
        kinn.deposit(address(rwaToken), 10_000);
        _assertEq(kinn.getTokenBalance(OWNER, address(rwaToken)), 10_000);

        vm.warp(START + 1 weeks);
        vm.prank(OWNER);
        kinn.checkIn();
        uint256 lastCheckIn = START + 1 weeks;
        _assertEq(kinn.getVault(OWNER).lastCheckIn, lastCheckIn);

        vm.warp(lastCheckIn + 2 weeks);
        _assertEq(kinn.missedCheckIns(OWNER), 1);
        _assertFalse(kinn.inheritanceEligible(OWNER));
        vm.warp(lastCheckIn + 4 weeks);
        _assertEq(kinn.missedCheckIns(OWNER), 2);
        _assertFalse(kinn.inheritanceEligible(OWNER));
        vm.warp(lastCheckIn + 6 weeks);
        _assertEq(kinn.missedCheckIns(OWNER), 3);
        _assertTrue(kinn.inheritanceEligible(OWNER));

        uint256 relayerBefore = RELAYER.balance;
        vm.prank(RELAYER);
        kinn.triggerInheritance(OWNER);
        _assertEq(RELAYER.balance, relayerBefore + kinn.automationFeeWei());

        vm.prank(RELAYER);
        kinn.distributeInheritanceToken(OWNER, address(rwaToken));
        _assertEq(rwaToken.balanceOf(ALICE), 5_000);
        _assertEq(rwaToken.balanceOf(BOB), 3_000);
        _assertEq(rwaToken.balanceOf(CHARLIE), 2_000);
        _assertEq(rwaToken.balanceOf(address(kinn)), 0);

        KinnVault.Vault memory completed = kinn.getVault(OWNER);
        _assertFalse(completed.active);
        _assertTrue(completed.inheritanceTriggered);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.InheritanceAlreadyTriggered.selector, OWNER));
        vm.prank(RELAYER);
        kinn.triggerInheritance(OWNER);

        vm.prank(RELAYER);
        kinn.claimCompletedAutomationReserve(OWNER);
        _assertEq(kinn.automationReserve(OWNER), 0);
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
