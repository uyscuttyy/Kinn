# Kinn — Testing Strategy (Phase 2)

Status: COMPLETE · 2026-08-28. Defines how each layer is tested so the phase gates are objective. Testing is a first-class deliverable; we do not stop at compilation.

## 1. Tooling

- **Contracts**: Foundry (`forge test`, `forge fuzz`, `forge invariant`—via `invariant` tests / `vm.assume`), solc 0.8.24.
- **Backend**: Node 22 `node --test` via `tsx` (existing `test:backend`), ethers v6.
- **Simulation/E2E**: Foundry fork tests + a Base Sepolia integration harness.
- **Static/dependency**: `forge fmt --check`, solc warnings, `npm audit`, Slither (Phase 10; not currently installed), tsconfig strict.

## 2. Contract tests (Phase 4 — comprehensive)

Unit + integration cases (from `CONTRACTS.md` §9):
- Factory: create once, duplicate suppressed, permissioned creation, discovery (`vaultOf`, `vaultAddresses`), deterministic CREATE2, `isVault`.
- Ownership/access: non-owner cannot configure/deposit/withdraw/checkIn/close; `initialize` factory-only & once.
- Beneficiaries: add/update/remove; validation — sum == 10000 BPs; reject < or > 100%; zero address; zero allocation; duplicates; > 50.
- Check-ins/timing: creation sets `lastCheckIn`; check-in resets full interval; missed thresholds exact; eligibility boundaries (just-before/at/after deadline); early trigger rejected; check-in cancellability before trigger; no cancellation after trigger.
- ETH + USDC: deposit/withdraw exact; accounting matches `(this.balance - reserve)` and ERC-20 balance; decimals-6 USDC path; ETH sentinel events.
- Distribution: multi-beneficiary exact split incl. rounding remainder; multiple assets; zero balance; failure->pending->retry; duplicate execute rejected; post-trigger owner ops rejected; deterministic ordering.
- Reserve: top-up/withdraw; fee paid on maintenance; not conflated with protected ETH; claim only when complete; rejected ETH payment keeps reserve and does not revert maintenance.
- Invalid state transitions: every invalid path reverts (see ARCHITECTURE §5).
- Reentrancy: malicious token/beneficiary attempts; isolated delivery reverts token-side and leaves entitlement pending.

## 3. Invariant / property tests (fuzz)

Locked invariants (Foundry `invariant` handlers + fuzz with `vm.assume`):
- `sum(beneficiaryAllocationBps) == 10000` invariant always.
- `distributed amount <= vault balance` at all times.
- Distribution cannot execute twice (processed flag + cleared entitlements; count monotonic).
- Non-owner cannot alter protected configuration.
- ETH + token balance conservation: `vaultAssets + distributedOut == deposited - withdrawn` (accounting matches real balances).
- Rounding: total distributed equals snapshot exactly (remainder to last).

## 4. Backend tests (Phase 6)

- API validation (allocation/address/amount/state errors; ownership not assumed by client).
- RPC failure handling (transport throws; cursor not advanced on partial failure).
- Duplicate events dedup by `(txHash, logIndex)`; restart/re-scan from durable cursor.
- Simulation: prepare -> eth_call -> expected result / revert reason surfaced; simulation never treated as confirmation.
- Transaction status: pending vs confirmed-by-receipt; confirmation depth handling.
- Keyless invariant: backend has no private-key path (test asserts no signing service exists for owner txs).
- Keeper: trigger/distribute/retry/claim idempotency; contract-state re-check before each submission; no double-submit.
- Auth: challenge binds wallet+chain+nonce; expiry; replay rejection; session scope.

## 5. End-to-end on Base Sepolia (Phase 11)

Full lifecycle with real transactions (fork or testnet):
1. Create a Kinn wallet (KeyManager) -> real address.
2. Fund with Sepolia ETH + USDC.
3. Create a Vault via factory; configure beneficiaries + inheritance (short dev interval).
4. Deposit ETH + USDC; verify vault balances are chain-derived.
5. Check in; verify `lastCheckIn` updated on-chain.
6. Miss the required check-ins; verify state to ELIGIBLE on-chain.
7. Trigger inheritance (permissionless) — record real tx + block.
8. Distribute per token; verify beneficiaries received exact amounts on-chain.
9. Assert duplicate trigger/distribution rejected on-chain.
10. Verify database/indexer reconstructed the full history from chain events.

## 6. Test-time acceleration

- Contract unit/invariant tests: Foundry `vm.warp` / `vm.assume` (deterministic, offline).
- Deployment-level dev/test: real short `checkInInterval` (e.g., 60 s) on a **dev/test deployment only**; production uses multi-day/week. There is **no** contract time-override backdoor, so acceleration can never be exploited in production.

## 7. Coverage gates

- Phase 4 gate: 0 failing contract tests; invariant suite green; all invalid-transition cases listed in ARCHITECTURE §5 have a test.
- Phase 6 gate: backend tests green; strict tsc; keyless-invariant test passes.
- Phase 11 gate: E2E lifecycle green on Base Sepolia with recorded real addresses/txes.
- Overall: `npm test` (contracts + backend) green before each phase close; `npm run build:backend` green.

## 8. Reporting

Each phase gate reports: files, tests run (names + pass/fail), security findings, known issues, decisions, next phase — per the operating instructions.