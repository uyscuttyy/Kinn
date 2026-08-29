// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.sol";
import {KinnVault} from "../src/KinnVault.sol";

contract KinnVaultCheckInTest is Base {
    function test_ActiveImmediatelyAfterCreation() public view {
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Active));
        assertFalse(vault.inheritanceEligible());
    }

    function test_MissedStateAfterOneInterval() public {
        vm.warp(block.timestamp + INTERVAL + 1);
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Missed));
        assertFalse(vault.inheritanceEligible());
        assertEq(vault.missedCheckIns(), 1);
    }

    function test_MissedStillConfigurable() public {
        vm.warp(block.timestamp + INTERVAL + 1);
        vm.prank(owner);
        vault.updateSettings(INTERVAL, MAX_MISSED); // must not revert
        vm.prank(owner);
        vault.checkIn(); // full reset allowed even while missed
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Active));
    }

    function test_EligibleAtPinnedFormula() public {
        assertEq(vault.eligibilityDeadline(), block.timestamp + uint256(INTERVAL) * MAX_MISSED);
        // One second before the deadline: not yet eligible.
        vm.warp(vault.eligibilityDeadline() - 1);
        assertFalse(vault.inheritanceEligible());
        // Exactly at the deadline: eligible.
        vm.warp(vault.eligibilityDeadline());
        assertTrue(vault.inheritanceEligible());
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Eligible));
        assertEq(vault.missedCheckIns(), MAX_MISSED);
    }

    function test_MissedCheckInsCountsIntervals() public {
        vm.warp(block.timestamp + INTERVAL * 2 + INTERVAL / 2);
        assertEq(vault.missedCheckIns(), 2);
        vm.warp(block.timestamp + INTERVAL * 10);
        assertEq(vault.missedCheckIns(), MAX_MISSED); // capped
    }

    function test_CheckInRestoresActiveAfterMissed() public {
        vm.warp(block.timestamp + INTERVAL * 2);
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Missed));
        vm.prank(owner);
        vault.checkIn();
        assertEq(uint8(vault.state()), uint8(KinnVault.InheritanceState.Active));
        assertEq(vault.missedCheckIns(), 0);
        assertEq(vault.eligibilityDeadline(), block.timestamp + uint256(INTERVAL) * MAX_MISSED);
    }

    function test_EligibilityShiftsWithSettingsChange() public {
        vm.prank(owner);
        vault.updateSettings(2 weeks, 2);
        assertEq(vault.eligibilityDeadline(), block.timestamp + 4 weeks);
    }

    function test_EligibilityNotResetByDeposits() public {
        _depositETH(1 ether);
        vm.warp(vault.eligibilityDeadline());
        assertTrue(vault.inheritanceEligible());
    }
}
