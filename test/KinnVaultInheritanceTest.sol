// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {KinnVault} from "../src/KinnVault.sol";
import {MockERC20} from "./MockERC20.sol";

interface Vm {
    function prank(address sender) external;
    function deal(address account, uint256 balance) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert(bytes4 selector) external;
    function warp(uint256 timestamp) external;
}

contract KinnVaultInheritanceTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    KinnVault private vault;
    MockERC20 private token;
    MockERC20 private tokenB;
    address private constant FACTORY = address(0xFac70);
    address private constant OWNER = address(0xA11CE);
    address private constant ALICE = address(0xB0B);
    address private constant BOB = address(0xCAFE);
    address private constant CHARLIE = address(0xC0DE);
    address private constant ETH = 0x1111111111111111111111111111111111111111;
    uint256 private constant FEE = 0.0001 ether;
    uint256 private constant START = 1_000_000;

    function setUp() public {
        vm.warp(START);
        token = new MockERC20();
        tokenB = new MockERC20();
        token.mint(OWNER, 1_000_000);
        tokenB.mint(OWNER, 500_000);
        address[] memory a = new address[](3);
        uint16[] memory b = new uint16[](3);
        a[0] = ALICE;
        a[1] = BOB;
        a[2] = CHARLIE;
        b[0] = 5_000;
        b[1] = 3_000;
        b[2] = 2_000;
        vault = new KinnVault(FACTORY, OWNER, 1 weeks, 2, a, b, FEE);
    }

    function _deposit(uint256 amount) private {
        vm.prank(OWNER);
        token.approve(address(vault), amount);
        vm.prank(OWNER);
        vault.deposit(address(token), amount);
    }

    function _eligible() private {
        vm.warp(START + 2 weeks);
    }

    // ---- trigger ----------------------------------------------------------

    function testTriggerRequiresEligibility() public {
        _deposit(10_000);
        vm.expectRevert(KinnVault.InheritanceNotEligible.selector);
        vault.triggerInheritance();
    }

    function testTriggerIsPermissionless() public {
        _deposit(10_000);
        _eligible();
        vault.triggerInheritance();
        assertTrue(vault.inheritanceTriggered());
        assertEq(uint256(vault.state()), uint256(KinnVault.InheritanceState.Distributing));
    }

    function testTriggerCannotRepeat() public {
        _deposit(10_000);
        _eligible();
        vault.triggerInheritance();
        vm.expectRevert(KinnVault.InheritanceAlreadyTriggered.selector);
        vault.triggerInheritance();
    }

    function testCheckInBeforeTriggerPreventsTrigger() public {
        _deposit(10_000);
        _eligible();
        vm.prank(OWNER);
        vault.checkIn();
        vm.expectRevert(KinnVault.InheritanceNotEligible.selector);
        vault.triggerInheritance();
    }

    // ---- ERC-20 distribution ----------------------------------------------

    function testDistributionPerAllocationWithRemainderToLast() public {
        _deposit(10_001);
        _eligible();
        vault.triggerInheritance();
        vault.distributeInheritanceAsset(address(token));
        assertEq(token.balanceOf(ALICE), 5_000);
        assertEq(token.balanceOf(BOB), 3_000);
        assertEq(token.balanceOf(CHARLIE), 2_001);
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(uint256(vault.state()), uint256(KinnVault.InheritanceState.Distributed));
    }

    function testDistributeMultipleAssets() public {
        _deposit(10_000);
        vm.prank(OWNER);
        tokenB.approve(address(vault), 4_000);
        vm.prank(OWNER);
        vault.deposit(address(tokenB), 4_000);
        _eligible();
        vault.triggerInheritance();
        vault.distributeInheritanceAsset(address(token));
        vault.distributeInheritanceAsset(address(tokenB));
        assertEq(token.balanceOf(ALICE), 5_000);
        assertEq(tokenB.balanceOf(ALICE), 2_000);
        assertEq(tokenB.balanceOf(BOB), 1_200);
        assertEq(tokenB.balanceOf(CHARLIE), 800);
        assertEq(vault.processedAssetCount(), 2);
    }

    function testDistributeWithoutAssetsStillDistributed() public {
        _eligible();
        vault.triggerInheritance();
        assertEq(uint256(vault.state()), uint256(KinnVault.InheritanceState.Distributed));
    }

    function testDistributeCannotRepeat() public {
        _deposit(10_000);
        _eligible();
        vault.triggerInheritance();
        vault.distributeInheritanceAsset(address(token));
        vm.expectRevert(abi.encodeWithSelector(KinnVault.AssetAlreadyProcessed.selector, address(token)));
        vault.distributeInheritanceAsset(address(token));
    }

    function testDistributeUnknownAssetRejected() public {
        _eligible();
        vault.triggerInheritance();
        vm.expectRevert(abi.encodeWithSelector(KinnVault.UnknownAsset.selector, address(tokenB)));
        vault.distributeInheritanceAsset(address(tokenB));
    }

    function testDistributeRequiresTrigger() public {
        _deposit(10_000);
        vm.expectRevert(KinnVault.InheritanceNotTriggered.selector);
        vault.distributeInheritanceAsset(address(token));
    }

    function testOwnerOperationsRejectedAfterTrigger() public {
        _deposit(10_000);
        _eligible();
        vault.triggerInheritance();
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultInactive.selector, OWNER));
        vm.prank(OWNER);
        vault.updateSettings(1 weeks, 1);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultInactive.selector, OWNER));
        vm.prank(OWNER);
        vault.withdraw(address(token), 1);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.VaultInactive.selector, OWNER));
        vm.prank(OWNER);
        vault.checkIn();
    }
// ---- native ETH distribution ------------------------------------------

    function testEthDistribution() public {
        vm.deal(OWNER, 10 ether);
        vm.prank(OWNER);
        vault.depositETH{value: 1 ether}();
        _eligible();
        vault.triggerInheritance();
        vault.distributeInheritanceAsset(ETH);
        assertEq(ALICE.balance, 0.5 ether);
        assertEq(BOB.balance, 0.3 ether);
        assertEq(CHARLIE.balance, 0.2 ether);
        assertEq(vault.protectedAssetBalance(ETH), 0);
        assertEq(uint256(vault.state()), uint256(KinnVault.InheritanceState.Distributed));
    }

    function testEthDistributionIsolatedFromReserve() public {
        vm.deal(OWNER, 10 ether);
        vm.prank(OWNER);
        vault.topUpAutomationReserve{value: 0.5 ether}();
        vm.prank(OWNER);
        vault.depositETH{value: 1 ether}();
        _eligible();
        vault.triggerInheritance();
        vault.distributeInheritanceAsset(ETH);
        assertEq(ALICE.balance, 0.5 ether);
        assertEq(BOB.balance, 0.3 ether);
        assertEq(CHARLIE.balance, 0.2 ether);
        assertEq(vault.automationReserve(), 0.5 ether - 2 * FEE); // fee paid on trigger and on distribute
    }

    // ---- failing delivery stays pending -----------------------------------

    function testEthPendingDeliveryRetries() public {
        RevertingRecipient rejector = new RevertingRecipient();
        address[] memory a = new address[](2);
        uint16[] memory b = new uint16[](2);
        a[0] = address(rejector);
        a[1] = BOB;
        b[0] = 5_000;
        b[1] = 5_000;
        KinnVault v = new KinnVault(FACTORY, OWNER, 1 weeks, 1, a, b, FEE);
        vm.deal(OWNER, 10 ether);
        vm.prank(OWNER);
        v.depositETH{value: 1 ether}();
        vm.warp(START + 1 weeks);
        v.triggerInheritance();
        v.distributeInheritanceAsset(ETH);
        assertEq(v.pendingInheritance(ETH, address(rejector)), 0.5 ether);
        assertEq(BOB.balance, 0.5 ether);
        assertEq(uint256(v.state()), uint256(KinnVault.InheritanceState.Distributing));

        uint256 readyAt = uint256(START + 1 weeks + 1 weeks);
        vm.expectRevert(abi.encodeWithSelector(KinnVault.RetryNotReady.selector, readyAt));
        v.retryInheritanceDistribution(ETH, address(rejector));
        vm.warp(readyAt);
        rejector.setAccept(true);
        v.retryInheritanceDistribution(ETH, address(rejector));
        assertEq(v.pendingInheritance(ETH, address(rejector)), 0);
        assertEq(uint256(v.state()), uint256(KinnVault.InheritanceState.Distributed));
    }

    function testTokenPendingDeliveryRetries() public {
        _deposit(10_000);
        token.setFalseAfterTransfer(true);
        _eligible();
        vault.triggerInheritance();
        vault.distributeInheritanceAsset(address(token));
        assertEq(vault.pendingInheritance(address(token), ALICE), 5_000);
        vm.warp(START + 2 weeks + 1 weeks);
        token.setFalseAfterTransfer(false);
        vault.retryInheritanceDistribution(address(token), ALICE);
        assertEq(vault.pendingInheritance(address(token), ALICE), 0);
        assertEq(token.balanceOf(ALICE), 5_000);
    }

    function assertTrue(bool value) private pure {
        require(value, "expected true");
    }

    function assertEq(uint256 a, uint256 b) private pure {
        require(a == b, "uint equality");
    }

    function assertEq(address a, address b) private pure {
        require(a == b, "address equality");
    }
}

contract RevertingRecipient {
    bool public accept;

    function setAccept(bool value) external {
        accept = value;
    }

    receive() external payable {
        require(accept, "no thanks");
    }
}
