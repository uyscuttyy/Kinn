# Kinn — Phase 10 Status: Security (§17)

Status: COMPLETE · 2026-09-01

Scope: automated static analysis, lint/format enforcement, dependency audit, and a manual
review pass over the contracts and the backend security boundary. Contracts remain
functionally unchanged (only lint annotations + canonical formatting). No independent
third-party audit has been performed; do not put real funds on this without one.

## 1. Baseline at phase start (verified)

- `forge build`: green · `forge test`: **121 tests, 0 failed** (12 suites)
- `npm run test:backend`: **98 tests, 0 failed**
- `npm run build:backend`: green (0 TS errors)

## 2. Automated review — findings and resolution

### forge lint (`forge lint src`)

| Finding | Count | Resolution |
|---|---|---|
| `unsafe-typecast` (KinnVault.sol `uint8(missed)`, `uint128(value)`) | 2 | **Annotated as provably safe** with `// forge-lint: disable-next-line(unsafe-typecast)` plus the reason inline. Both carry a preceding bound: `missed` is capped by `maxMissedCheckIns` (≤ `MAX_MISSED_CHECK_INS`) before the cast, and `_toUint128` reverts via `ReserveOverflow()` when the value exceeds `uint128` range. Lint is now clean of unsafe casts. |
| `block-timestamp` (state/retry/missed-count comparisons) | 4 | **Accepted by design.** Eligibility, missed-count, and retry timing intentionally derive from `block.timestamp`, per SECURITY.md §4: coarse multi-period deadlines cannot be materially skipped by minor validator timestamp adjustments. Leaving the lint visible is deliberate so reviewers see these sites. |

### forge fmt

- `forge fmt --check` was not clean at phase start (pre-existing canonical-style drift in
  this branch's working tree). Applied `forge fmt`; now `FMT_CLEAN`.
- Formatting is whitespace-only and semantics-preserving; the full contract suite was
  re-run after formatting: **121/121 pass**.
- The only non-whitespace `KinnVault.sol` changes in this phase are the two lint
  annotation comment blocks above.

## 3. Dependency audit

`npm audit` at phase start: **4 vulnerabilities** (2 moderate, 2 high), all transitive:

| Path | Advisory | Action |
|---|---|---|
| `ws` via `ethers@6.15.0` | high (memory disclosure / DoS) | `npm audit fix` moved ethers to **6.17.0** (`ws` now patched). Verified: tsc clean, **98/98 backend tests pass**, 121/121 contract tests pass. |
| `axios` via `@coinbase/cdp-sdk` (→`@base-org/account`→`@reown/appkit`→`@walletconnect/ethereum-provider`) | moderate/high (prototype pollution, DoS) | cdp-sdk pins axios `1.16.0` exactly. Added `overrides: { axios: "^1.20.0" }`. Verified axios is **not bundled** into `dist/wallet-client.js` and is not imported by any Kinn source — the vulnerable path was already unreachable; the override removes the audit finding entirely. |

Result: `npm audit` → **0 vulnerabilities**.

## 4. Manual review — contract authority model (KinnVault.sol / VaultFactory.sol)

Every external state-mutating function was re-inspected for auth, reentrancy,
checks-effects-interactions, and asset-accounting correctness:

- **Owner writes** (`updateSettings`, `updateBeneficiaries`, `deposit`, `depositETH`,
  `withdraw`, `topUpAutomationReserve`, `withdrawAutomationReserve`, `closeVault`,
  `checkIn`) — all `onlyOwner` or `msg.sender == owner`; all rejected once
  `inheritanceTriggered`/`closed` via `_requireConfigurable`. No factory/deployer/backend
  authority to alter vault terms or move assets (no admin backdoor).
- **Fund-moving external calls** — every one is wrapped in `nonReentrant`:
  `deposit`, `depositETH`, `withdraw`, `withdrawAutomationReserve`,
  `triggerInheritance`, `distributeInheritanceAsset`, `retryInheritanceDistribution`,
  `claimAutomationReserve`. Token delivery goes through the isolated, gas-capped
  `attemptTokenTransfer` (`OnlySelf`), verifying exact balance delta; failed delivery
  leaves the entitlement pending and retryable rather than lost.
- **Inheritance eligibility** — computed on-chain from `state()`; the permissionless
  `triggerInheritance` reverts unless `Eligible`; the transition is permanent.
- **Double distribution** — `inheritanceAssetProcessed[asset]` snapshot-once flag plus
  clearing of successful entitlements; `retryInheritanceDistribution` only pays stored
  unpaid amounts and honors `nextDistributionRetry`.
- **Asset accounting** — deposits use the received balance-delta (`received =
  after - before`), rejecting fee-on-transfer and no-op transfers; ETH is bounded by
  on-chain balance, never by input.
- **Automation reserve** — native ETH only, isolated from protected assets; reimburses
  only valid maintenance calls; `claimAutomationReserve` is gated on full completion
  (`processedAssetCount == tracked length` and `_pendingCount == 0`); failed native
  payment restores the reserve and does not revert the underlying maintenance action.
- **Rounding** — last beneficiary receives the exact remainder; allocations must sum to
  exactly 100% (10000 bps) and are enforced on update.

Full attack matrix and expected results: SECURITY.md §5; fixed historical findings:
SECURITY_REVIEW.md.

## 5. Manual review — backend boundary invariants (re-affirmed)

Verified by inspection across `backend/src/**`:

1. **Never-sign-or-submit for owner actions** — the only `sendTransaction` paths are the
   hosted wallet's `eth_sendTransaction` delegation (the user's own wallet signs;
   the backend never holds or uses those keys) and the managed `RelayerSigner` used
   exclusively for permissionless maintenance calls. The legacy raw-key ingestion is
   confined behind the injected signer provider (`createRelayerSignerProvider`).
2. **Source-of-truth boundary** — the durable DB layer stores indexed/cache data;
   eligibility, balances, and entitlements are always re-derived from chain state by the
   contract, never trusted from backend records.
3. **No key leakage** — no raw private-key references outside the relayer signer path;
   keys are never logged, persisted raw, or exposed via the API surface.

## 6. Residual risks / limitations (unchanged, documented)

- Issuer freezes/pauses/blacklists can leave distributions pending indefinitely (not a
  Kinn bug); fee-on-transfer/rebasing/reflection tokens remain unsupported.
- No independent third-party audit yet — required before real funds (SECURITY.md §5).
- Relayer liveness (not safety) depends on keeper availability; trigger/distribute are
  permissionless so any party can advance inheritance.

