# Kinn — Security Model (Phase 2)

Status: COMPLETE · 2026-08-28. This defines the security model and the adversarial testing plan. It extends the earlier `SECURITY_REVIEW.md`/`FINAL_REVIEW.md` findings into the Factory/instance/wallet-first architecture. Do not claim production security without an independent audit.

## 1. Trust model

- **Kinn contract (VaultFactory + KinnVault instances)** — highest trust. Owns and enforces all protected-asset logic. Must be independently audited before real funds.
- **Kinn user wallet** — signs and broadcasts its own transactions; key never leaves the wallet except under the user's own encryption secret.
- **Kinn backend** — low trust. Can read, prepare, simulate, index, notify, and run a permissionless keeper. It cannot: move user funds, change beneficiaries/allocations/check-ins, withdraw assets, falsely trigger inheritance, replace ownership, or hold user private keys.
- **Keeper/relayer** — permissionless actor performing maintenance (trigger/distribute/retry/claim); limited to calls the contract independently validates. Cannot choose recipients or amounts.
- **Token issuers / malicious tokens** — untrusted inputs; handled with isolation and balance invariants.

## 2. Primary security guarantees (targets for adversarial tests)

1. **Backend compromise cannot move funds**: no backend signer path for owner actions; owner writes require the user's signature; all owner-authorization on-chain.
2. **No admin backdoor**: no function lets the factory/deployer/backend alter a vault's beneficiaries, allocations, check-in rules, or withdraw assets on an owner's behalf.
3. **Inheritance eligibility is on-chain**: a compromised backend cannot declare inheritance eligible early; the contract recomputes the deadline from chain state.
4. **Double distribution is impossible**: one-time per-token snapshot + clearing of successful entitlements + isolated exact-balance transfer; independently verifiable.
5. **Reentrancy is prevented**: `nonReentrant` on every external call that moves funds; call ordering checks-effects-interactions.
6. **Overflow/underflow prevented**: Solidity 0.8 checked arithmetic on all fund math; ETH balance bounds re-derived on-chain, never trusted from input.
7. **Time cannot be manipulated in production**: no time-override backdoor; eligibility from `block.timestamp`; coarse multi-period boundaries.
8. **Check-in cannot be forged remotely**: `checkIn` requires `msg.sender == owner`.
9. **Tokens cannot be stolen via malicious ERC-20**: distribution uses an isolated, gas-capped self-call that reverts token-side state on failure and verifies the exact balance delta.
## 3. Explicitly mitigated attacks (existing + new)

- Become owner: instance `owner` set once via `initialize` (factory-only); no setter.
- Change beneficiaries/allocations: owner-only, gated by state.
- Withdraw funds: owner-only, exact-amount checks, transfer guarded; ETH bounded by on-chain balance.
- Trigger inheritance early: `state == Eligible` required on-chain.
- Prevent inheritance / DoS: distribution is one-token-per-tx; retry is permissionless; gas-capped delivery; beneficiary cap.
- Distribute twice: snapshot + clearing + invariant checks (guarantee 4).
- Bypass check-ins: ownership + state-gated; derived missed-count.
- Exploit rounding: remainder to last beneficiary; deterministic order; total conserved.
- Reentrancy: guard on external/moving calls; isolated delivery.
- Backend compromise: no authority granted (guarantee 1/2).
- Permanently lock funds in a malicious token: failed delivery stays pending, retryable; issuer freeze is a documented limitation (not a Kinn bug).

## 4. Documented limitations (not silently hidden)

- Issuer freezes/blacklists/pauses can leave distribution pending indefinitely; Kinn cannot bypass token-issuer controls.
- Fee-on-transfer, rebasing, reflection, and administratively destructive tokens are unsupported; the supported set (ETH + USDC) is bounded and tested; other ERC-20s are blocked until proven.
- `block.timestamp` can be adjusted slightly by block producers; cannot materially skip a configured multi-period deadline.
- Contract upgrade (if a proxy/clone is used) applies to all instances at once; any such change must itself be audited.
- A compromised or malicious relayer cannot steal, but may fail to advance inheritance (liveness, not safety); acceptable because trigger/distribute are permissionless by anyone.

## 5. Adversarial testing matrix (Phase 10)

| Attack | Expected result | Evidence |
|---|---|---|
| Become owner | revert | test |
| Change beneficiaries as non-owner | revert | test |
| Change allocations to != 100% | revert | test |
| Withdraw as non-owner / more than balance | revert | test |
| Trigger inheritance early | revert | boundary test |
| Trigger twice | revert | test |
| Distribute twice | revert / no double send | test + invariant |
| Check-in for another user | revert | test |
| Rounding exploit | remainder -> last, total conserved | property fuzz |
| Reentrancy (malicious token/beneficiary) | reverted / isolated | reentrancy test |
| Backend compromise attempted forged write | no authority | integration/adversarial |
| ETH/token accounting mismatch | invariant violation impossible | invariant fuzz |
| Automated review | run | Phase 10 |
| Manual review (every external fn/mutation/move/auth/call/time calc) | report | Phase 10 |
| Dependency audit | report | Phase 10 |
| Independent audit | external | before mainnet real funds |

## 6. Operational security

- Private keys: only in the user's encrypted KeyManager; never logged, printed, stored raw in DB, committed, or exposed via API. Relayer runs behind a managed signer.
- Secrets (.env: bot tokens, RPC keys, secrets) stay out of git; rotate anything that appeared in a shared workspace.
- Backend has least privilege; no endpoint accepts signed owner txs except the user's own broadcast path (which still requires the user's signature).
- A compromised backend can spam maintenance; rate-limit/allowlist at the API layer does not affect on-chain safety.
10. **Automation reserve cannot be conflated with protected ETH**: two distinct accounting paths; top-ups/withdrawals/claims never touch protected assets.