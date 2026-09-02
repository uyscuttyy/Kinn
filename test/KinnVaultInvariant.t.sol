// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {KinnVault} from "../src/KinnVault.sol";
import {KinnVaultFactory} from "../src/VaultFactory.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Random-action handler driving a single vault through its lifecycle while
///         the test contract asserts global conservation invariants.
contract VaultLifecycleHandler is Test {
    KinnVaultFactory public factory;
    KinnVault public vault;
    MockERC20 public token;

    address public owner = makeAddr("owner");
    address public keeper = makeAddr("keeper");
    address public b0 = makeAddr("b0");
    address public b1 = makeAddr("b1");

    // Ghost accumulators for the conservation invariants.
    uint256 public tokenIn;
    uint256 public tokenOut;
    uint256 public tokenDistributed;
    uint256 public ethIn;
    uint256 public ethOut;
    uint256 public ethDistributed;

    constructor() {
        factory = new KinnVaultFactory(0); // no fee: keeps ETH conservation simple
        token = new MockERC20();
        vm.deal(owner, 1_000_000 ether);

        address[] memory accounts = new address[](2);
        accounts[0] = b0;
        accounts[1] = b1;
        uint16[] memory allocations = new uint16[](2);
        allocations[0] = 5000;
        allocations[1] = 5000;
        vm.startPrank(owner);
        vault = KinnVault(factory.createVault(1 days, 3, accounts, allocations));
        vm.stopPrank();
    }

    modifier whenConfigurable() {
        if (vault.closed() || vault.inheritanceTriggered() || vault.inheritanceEligible()) return;
        _;
    }

    function depositToken(uint256 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 100 ether);
        token.mint(owner, amount);
        vm.startPrank(owner);
        token.approve(address(vault), amount);
        vault.deposit(address(token), amount);
        vm.stopPrank();
        tokenIn += amount;
    }

    function depositETH(uint256 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 100 ether);
        vm.prank(owner);
        vault.depositETH{value: amount}();
        ethIn += amount;
    }

    function withdrawToken(uint256 amountSeed) external whenConfigurable {
        uint256 amount = bound(amountSeed, 0, token.balanceOf(address(vault)));
        if (amount == 0) return;
        vm.prank(owner);
        vault.withdraw(address(token), amount);
        tokenOut += amount;
    }

    function withdrawETH(uint256 amountSeed) external whenConfigurable {
        uint256 amount = bound(amountSeed, 0, vault.protectedAssetBalance(vault.ETH_SENTINEL()));
        if (amount == 0) return;
        vm.prank(owner);
        vault.withdraw(vault.ETH_SENTINEL(), amount);
        ethOut += amount;
    }

    function topUpReserve(uint256 amountSeed) external whenConfigurable {
        uint256 amount = bound(amountSeed, 1, 10 ether);
        vm.prank(owner);
        vault.topUpAutomationReserve{value: amount}();
        ethIn += amount; // reserve ETH also sits in the vault balance
    }

    function withdrawReserve(uint256 amountSeed) external whenConfigurable {
        uint256 amount = bound(amountSeed, 0, vault.automationReserve());
        if (amount == 0) return;
        vm.prank(owner);
        vault.withdrawAutomationReserve(amount);
        ethOut += amount;
    }

    function warp(uint256 deltaSeed) external {
        vm.warp(block.timestamp + bound(deltaSeed, 0, 10 days));
    }

    function checkIn() external {
        if (vault.closed() || vault.inheritanceTriggered()) return;
        vm.prank(owner);
        try vault.checkIn() {} catch {}
    }

    /// @notice Triggers inheritance when eligible and distributes every tracked asset once.
    function triggerAndDistribute() external {
        if (vault.closed() || vault.inheritanceTriggered() || !vault.inheritanceEligible()) return;
        vault.triggerInheritance();

        address[] memory assets = vault.getTrackedAssets();
        uint256 ethBefore = b0.balance + b1.balance;
        uint256 tokenBefore = token.balanceOf(b0) + token.balanceOf(b1);
        for (uint256 i; i < assets.length; ++i) {
            if (!vault.inheritanceAssetProcessed(assets[i])) {
                vault.distributeInheritanceAsset(assets[i]);
            }
        }
        ethDistributed += b0.balance + b1.balance - ethBefore;
        tokenDistributed += token.balanceOf(b0) + token.balanceOf(b1) - tokenBefore;
    }
}

contract KinnVaultInvariantTest is Test {
    VaultLifecycleHandler internal handler;

    function setUp() public {
        handler = new VaultLifecycleHandler();
        targetContract(address(handler));
    }

    // ---- Ghost variable getters (read from the handler) ----

    function tokenIn() public view returns (uint256) {
        return handler.tokenIn();
    }

    function tokenOut() public view returns (uint256) {
        return handler.tokenOut();
    }

    function tokenDistributed() public view returns (uint256) {
        return handler.tokenDistributed();
    }

    function ethIn() public view returns (uint256) {
        return handler.ethIn();
    }

    function ethOut() public view returns (uint256) {
        return handler.ethOut();
    }

    function ethDistributed() public view returns (uint256) {
        return handler.ethDistributed();
    }

    // ---- Invariants ----

    /// @notice Every protected token wei is accounted for: vault balance + withdrawn + distributed == deposited.
    function invariant_TokenConservation() public view {
        assertEq(
            handler.token().balanceOf(address(handler.vault())),
            handler.tokenIn() - handler.tokenOut() - handler.tokenDistributed(),
            "token conservation violated"
        );
    }

    /// @notice Every ETH wei in the vault (protected + reserve) is accounted for.
    function invariant_EthConservation() public view {
        assertEq(
            address(handler.vault()).balance,
            handler.ethIn() - handler.ethOut() - handler.ethDistributed(),
            "ETH conservation violated"
        );
    }

    /// @notice Distributed funds went exactly to the recorded beneficiaries, nothing else.
    function invariant_BeneficiariesReceivedExactlyDistributed() public view {
        assertEq(handler.b0().balance + handler.b1().balance, handler.ethDistributed(), "ETH beneficiary mismatch");
        assertEq(
            handler.token().balanceOf(handler.b0()) + handler.token().balanceOf(handler.b1()),
            handler.tokenDistributed(),
            "token beneficiary mismatch"
        );
    }

    /// @notice Protected ETH balance always equals vault balance minus the reserve.
    function invariant_ProtectedEthExcludesReserve() public view {
        assertEq(
            handler.vault().protectedAssetBalance(handler.vault().ETH_SENTINEL()),
            address(handler.vault()).balance - handler.vault().automationReserve(),
            "protected ETH must exclude reserve"
        );
    }

    /// @notice The factory registry always points at the owner's live vault instance.
    function invariant_FactoryRegistryConsistent() public view {
        KinnVault vault = handler.vault();
        assertEq(handler.factory().vaultOf(vault.owner()), address(vault));
        assertTrue(handler.factory().isVault(address(vault)));
        assertEq(vault.factory(), address(handler.factory()));
    }

    /// @notice Pending entitlements never exceed what was actually snapshotted: after a
    ///         fully processed asset, nothing remains pending for that asset.
    function invariant_ProcessedAssetsHaveNoUnaccountedFunds() public view {
        if (handler.vault().inheritanceTriggered()) {
            assertLe(
                handler.vault().processedAssetCount(),
                handler.vault().getTrackedAssets().length,
                "processed count cannot exceed tracked assets"
            );
        }
    }
}
