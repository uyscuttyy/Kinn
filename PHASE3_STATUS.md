# Kinn — Phase 3 Status Note

Status: BUILD-IN-PROGRESS · 2026-08-28

Phase 3 is the smart-contract rebuild per `CONTRACTS.md`. It is a fresh build (per direction, the old single-contract form was demolished/refactored). The audited inheritance *concepts* (allocation validation, per-asset distribution + rounding remainder, retry of failed deliveries, isolated gas-capped transfer with balance invariant, automation reserve) are preserved but re-located into the new per-owner instance.

## What was built (src)

- `src/KinnVault.sol` — per-owner **instance** contract (rebuilt from scratch):
  - Explicit `InheritanceState` enum `{Active, Missed, Eligible, Distributing, Distributed, Closed}`.
  - Pinned eligibility formula: `eligibleAt = lastCheckIn + interval * maxMissedCheckIns`; `state()` derives Active/Missed/Eligible from chain time; Distributing/Distributed stored once triggered.
  - `ETH_SENTINEL` asset representation; native-ETH deposit/withdraw/distribution path; automation reserve kept strictly separate.
  - Owner-only config/deposit/withdraw/check-in/close; permissionless trigger/distribute/retry/claim (contract validates eligibility + snapshot-once).
  - Double-distribution prevention (per-asset processed flag + successful-entitlement clearing); retry model retained.
  - ERC-20 path rejects fee-on-transfer (balance-delta check).
- `src/VaultFactory.sol` — factory: CREATE2 deployment, one-vault-per-user (revert if exists), owner->vault registry, discovery (`vaultOf`, `vaultCount`, `vaultAt`, `isVault`), idempotent creation.
- `src/interfaces/IKinnVault.sol`, `src/interfaces/IVaultFactory.sol` — service-facing interfaces.

## Refactored / updated

- `script/DeployKinn.s.sol` — now deploys `KinnVaultFactory` (removed the obsolete single-contract deploy that no longer matched).

## Intentionally still red (Phase 4 will rebuild)

- The previous `test/*.t.sol` suite (KinnVault, KinnVaultAssets, KinnVaultCheckIn, KinnVaultInheritance, KinnVaultAutomationReserve, KinnEndToEnd) targeted the old single-contract `mapping(owner=>Vault)` API and no longer compiled against the new instance model. Per the Phase 3 directive, these stale tests were **removed** to leave the build clean (no red). `test/MockERC20.sol` is retained and will be reused.
- Phase 4 will **write a fresh, comprehensive suite** for the Factory + instance model.

## Build status (current)

- `forge build` (full, including remaining `test/MockERC20.sol`) → **OK**.
- `forge test` → no tests yet (expected; Phase 4 adds them). Source + interfaces + scripts + `TestRwaToken`/`MockERC20` compile cleanly.
- Two `forge-lint unsafe-typecast` warnings remain (uint8 missed count, uint128 reserve) — checked and safe; will be annotated or handled in the Phase 10 static review.

## Not yet started

- Backend (`backend/`) re-pointing to factory+instance (Phase 6) — unchanged this phase and not required for Phase 3.
- Telegram untouched (frozen).