// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {KinnVault} from "../src/KinnVault.sol";
import {KinnVaultFactory} from "../src/VaultFactory.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Receiver whose acceptance of ETH can be toggled at runtime.
contract ToggleReceiverFuzz {
    bool public accept;

    function setAccept(bool value) external {
        accept = value;
    }

    receive() external payable {
        if (!accept) revert("no");
    }
}

contract KinnVaultFuzzTest is Test {
    KinnVaultFactory internal factory;
    MockERC20 internal token;
    ToggleReceiverFuzz internal toggle;

    address internal owner = makeAddr("owner");
    address internal keeper = makeAddr("keeper");
    address internal b0 = makeAddr("b0");
    address internal b1 = makeAddr("b1");
    address[] internal accounts;
    uint16[] internal allocations;

    uint64 internal constant INTERVAL = 1 days;
    uint8 internal constant MAX_MISSED = 3;
    uint256 internal constant FEE = 0.05 ether;
    uint256 internal constant DEADLINE = uint256(INTERVAL) * MAX_MISSED;

    function setUp() public {
        factory = new KinnVaultFactory(FEE);
        token = new MockERC20();
        toggle = new ToggleReceiverFuzz();
        vm.deal(owner, 1000 ether);
        accounts = new address[](2);
        accounts[0] = b0;
        accounts[1] = b1;
        allocations = new uint16[](2);
        allocations[0] = 5000;
        allocations[1] = 5000;
    }

    function _createDefaultVault() internal returns (KinnVault) {
        vm.prank(owner);
        return KinnVault(factory.createVault(INTERVAL, MAX_MISSED, accounts, allocations));
    }

    /// @dev Builds `count` allocations that always sum to exactly 10_000 bps, each >= 1.
    function _allocationsFor(uint256 count) internal pure returns (uint16[] memory result) {
        result = new uint16[](count);
        if (count == 1) {
            result[0] = 10_000;
            return result;
        }
        uint256 maxEach = (10_000 - (count - 1)) / (count - 1);
        uint256 sum;
        for (uint256 i; i < count - 1; ++i) {
            result[i] = uint16(bound(uint256(i) + 7, 1, maxEach));
            sum += result[i];
        }
        result[count - 1] = uint16(10_000 - sum);
    }

    /// @notice Fuzzes the allocation split: every wei must land with a beneficiary,
    ///         the last one absorbing the rounding remainder.
    function testFuzz_AllocationSplit(uint256 amountSeed, uint256 countSeed, bool useETH) public {
        uint256 count = bound(countSeed, 1, 50);
        uint16[] memory allocs = _allocationsFor(count);
        address[] memory accs = new address[](count);
        for (uint256 i; i < count; ++i) {
            accs[i] = makeAddr(string(abi.encodePacked("fz", i)));
        }

        vm.startPrank(owner);
        KinnVault v = KinnVault(factory.createVault(INTERVAL, MAX_MISSED, accs, allocs));
        uint256 amount = bound(amountSeed, 1, 1000 ether);
        if (useETH) {
            v.depositETH{value: amount}();
        } else {
            token.mint(owner, amount);
            token.approve(address(v), amount);
            v.deposit(address(token), amount);
        }
        vm.stopPrank();

        vm.warp(DEADLINE + 1);
        v.triggerInheritance();
        v.distributeInheritanceAsset(useETH ? v.ETH_SENTINEL() : address(token));

        uint256 distributed;
        for (uint256 i; i < count; ++i) {
            uint256 expected = i == count - 1 ? amount - distributed : amount * allocs[i] / 10_000;
            uint256 got = useETH ? accs[i].balance : token.balanceOf(accs[i]);
            assertEq(got, expected, "share mismatch");
            distributed += got;
        }
        assertEq(distributed, amount, "conservation violated");
    }

    /// @notice Fuzzes the eligibility state machine against the pinned formula.
    /// @dev lastCheckIn is 1 (setUp block time), so the deadline is 1 + INTERVAL * MAX_MISSED.
    function testFuzz_EligibilityFormula(uint256 timeSeed) public {
        KinnVault v = _createDefaultVault();
        uint256 deadline = v.eligibilityDeadline(); // 1 + INTERVAL * MAX_MISSED
        uint256 t = bound(timeSeed, uint64(1), 10 * DEADLINE);
        vm.warp(t);

        assertEq(v.inheritanceEligible(), t >= deadline, "eligibility mismatch");
        uint256 missed = (t - 1) / INTERVAL;
        assertEq(v.missedCheckIns(), missed > MAX_MISSED ? MAX_MISSED : missed, "missed mismatch");
        assertEq(v.eligibilityDeadline(), 1 + DEADLINE, "deadline mismatch");
    }

    /// @notice Fuzzes settings validation: only 1..9 weeks and 1..5 missed are accepted.
    function testFuzz_SettingsValidation(uint64 interval, uint8 missed) public {
        bool validInterval = interval >= 1 && interval <= 9 weeks;
        bool validMissed = missed >= 1 && missed <= 5;
        vm.startPrank(owner);
        if (validInterval && validMissed) {
            address v = factory.createVault(interval, missed, accounts, allocations);
            assertTrue(v != address(0));
            assertEq(KinnVault(v).checkInInterval(), interval);
            assertEq(KinnVault(v).maxMissedCheckIns(), missed);
        } else {
            try factory.createVault(interval, missed, accounts, allocations) {
                fail(); // must have reverted
            } catch {}
        }
        vm.stopPrank();
    }

    /// @notice Fuzzes the automation-fee partial payment: caller gets min(reserve, fee).
    function testFuzz_ReservePartialFee(uint256 topUpSeed) public {
        KinnVault v = _createDefaultVault();
        uint256 topUp = bound(topUpSeed, 0, 1 ether);
        if (topUp > 0) {
            vm.prank(owner);
            v.topUpAutomationReserve{value: topUp}();
        }

        uint256 keeperBefore = keeper.balance;
        vm.warp(DEADLINE + 1);
        vm.prank(keeper);
        v.triggerInheritance();

        uint256 paid = topUp < FEE ? topUp : FEE;
        assertEq(v.automationReserve(), topUp - paid);
        assertEq(keeper.balance, keeperBefore + paid);
    }

    /// @notice Fuzzes the retry window: retry succeeds exactly once the window has elapsed.
    function testFuzz_RetryWindow(uint256 jumpSeed) public {
        accounts[1] = address(toggle);
        vm.prank(owner);
        KinnVault v = KinnVault(factory.createVault(INTERVAL, MAX_MISSED, accounts, allocations));
        accounts[1] = b1;

        vm.prank(owner);
        v.depositETH{value: 2 ether}();
        vm.warp(DEADLINE + 1);
        vm.startPrank(keeper);
        v.triggerInheritance();
        v.distributeInheritanceAsset(v.ETH_SENTINEL());
        vm.stopPrank();
        assertEq(v.pendingInheritance(v.ETH_SENTINEL(), address(toggle)), 1 ether);
        uint256 retryAt = v.nextDistributionRetry(v.ETH_SENTINEL(), address(toggle));

        uint256 jump = bound(jumpSeed, 0, 2 * INTERVAL);
        vm.warp(DEADLINE + 1 + jump); // absolute time relative to the failed distribution
        toggle.setAccept(true);
        vm.prank(keeper);
        if (jump >= INTERVAL) {
            v.retryInheritanceDistribution(v.ETH_SENTINEL(), address(toggle));
            assertEq(address(toggle).balance, 1 ether);
            assertEq(v.pendingInheritance(v.ETH_SENTINEL(), address(toggle)), 0);
        } else {
            try v.retryInheritanceDistribution(v.ETH_SENTINEL(), address(toggle)) {
                fail(); // retry must not be ready yet
            } catch {}
            assertEq(address(toggle).balance, 0);
        }
    }
}
