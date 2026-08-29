# Kinn — Phase 4 Status Note

Status: COMPLETE · 2026-08-29

Phase 4 delivered a fresh, comprehensive Foundry test suite for the Phase 3 Factory + per-owner
instance model (`src/KinnVault.sol`, `src/VaultFactory.sol`). The old single-contract suite was
removed in Phase 3; nothing from it was reused except `test/MockERC20.sol`.

## Suite layout (test/)

- `Base.sol` — shared fixtures: factory (0.1 ether automation fee), owner vault (1 day interval,
  3 missed check-ins, 50/50 beneficiaries), MockERC20, `RevertingReceiver` and `ToggleReceiver`
  (beneficiary that rejects/accepts ETH via a flag).
- `KinnVaultFactory.t.sol` (6) — CREATE2 creation, one-open-vault-per-owner, closed-vault
  recreation, registry/discovery (`vaultOf`, `vaultCount`, `vaultAt`, `isVault`), owner isolation
  between vaults, constructor validation.
- `KinnVaultConfig.t.sol` (16) — owner authorization on every owner function, factory cannot act
  on a vault, settings validation (interval ≤ 9 weeks, missed 1–5), beneficiary validation
  (0-length, length mismatch, sum ≠ 10000, zero allocation, zero address, duplicates, 50 max),
  check-in, close rules (assets/ETH/reserve/triggered), closed-vault rejection of all actions.
- `KinnVaultAssets.t.sol` (13) — ERC-20 + ETH deposit/withdraw, asset tracking, reserve not
  counted as protected balance, invalid inputs, insufficient balances, failing `transferFrom`,
  reserve top-up/withdraw, `onlySelf` guard on the isolated transfer helpers.
- `KinnVaultCheckIn.t.sol` (8) — full state machine: Active → Missed → Eligible, pinned
  eligibility formula (`lastCheckIn + interval * maxMissed`, inclusive at the deadline),
  missed-count math and cap, check-in full reset, settings shift the deadline, deposits do not
  reset eligibility.
- `KinnVaultInheritance.t.sol` (17) — permissionless trigger, not-eligible/already-triggered/
  closed reverts, per-asset snapshot-once distribution, rounding remainder to the last
  beneficiary, zero-balance assets still processed, failed ETH/token delivery stays pending with
  funds unlost, retry window enforcement, retry to the recorded beneficiary, double-processing
  prevention, false-returning (reflection-style) token stays pending then retries exactly.
- `KinnVaultAutomationReserve.t.sol` (7) — fee paid on trigger and on every
  `distributeInheritanceAsset` call, partial fee when reserve < fee, trigger without reserve,
  `claimAutomationReserve` only after full distribution, incomplete-distribution revert.
- `KinnEndToEnd.t.sol` (2) — full lifecycle (deposit ETH + token + reserve → miss check-ins →
  trigger → distribute both assets → owner locked out → keeper claims leftover reserve) and a
  check-in loop keeping the vault alive indefinitely.
- `KinnVaultFuzzTest.t.sol` (5 fuzz tests × 256 runs) — allocation split conservation across
  1–50 beneficiaries (every wei lands; rounding remainder to the last), eligibility formula
  fuzzed against the pinned deadline, settings validation acceptance set, automation-fee
  partial payment `min(reserve, fee)`, retry-window boundary (succeeds exactly when elapsed).
- `KinnVaultInvariant.t.sol` (6 invariants; handler-driven lifecycle, runs=32 × depth=128) —
  token conservation (vault balance + withdrawn + distributed == deposited), ETH conservation
  (protected + reserve), beneficiaries receive exactly what was distributed, protected ETH
  always excludes the reserve, factory registry consistency, processed count ≤ tracked assets.
  Driven by `VaultLifecycleHandler` random actions: deposits, withdrawals, reserve top-up/
  withdrawal, time warps, check-ins, and full trigger+ distribute cycles.

## Result

- `forge build` → OK. `forge test` → **12 suites, 121 tests (110 unit/E2E + 5 fuzz + 6
  invariant), 0 failures.**

## Environment note

- `lib/forge-std` was pinned to a commit contemporaneous with the local forge binary (1.7.1);
  the newest forge-std master uses cheatcodes this binary does not know.

## Contract fix made during Phase 4

- `src/VaultFactory.sol::createVault` — the previous check reverted `VaultAlreadyExists` whenever
  `vaultOf[owner] != 0`, which permanently blocked vault re-creation after `closeVault()`
  (contradicting the documented "owner may create a new vault" behavior, and caught by
  `test_CloseThenRecreate`). It now only reverts when the existing vault is still open
  (`!KinnVault(existing).closed()`); a closed vault frees the slot and the new vault overwrites
  the registry entry.

## Intentionally removed

- Stale leftovers from the pre-Phase-3 attempt (`test/KinnVaultFuzzTest.sol`,
  `test/KinnVaultInvariantTest.sol`, `test/VaultFactoryTest.sol`, tracked
  `test/KinnVaultInheritanceTest.sol`) — hand-rolled Vm-interface tests that no longer matched
  the instance model and conflicted with the fresh suite.

## Not yet started

- Backend re-pointing to factory+instance (Phase 6). Telegram remains frozen.
