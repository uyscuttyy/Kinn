# Kinn — Backend API (Phase 2)

Status: COMPLETE · 2026-08-28. REST API for the future Web App. Designed around the architecture (not Telegram endpoint names). Initial chain Base/Sepolia via deployment config. This is the contract the backend (Phase 6) implements and the frontend consumes.

## Conventions

- Base URL per deployment: `https://<service>/api/v1/<networkKey>` (networkKey from `KINN_NETWORKS`).
- JSON; all big integers serialized as **decimal strings**.
- Auth: bearer session token from `/auth/*`. Owner-write endpoints require a verified wallet session bound to chain + nonce (EIP-712).
- Prepared writes return an **unsigned** `PreparedTransaction`; the wallet signs and broadcasts. The API never submits authoritatively.
- Objects: `amount` strings, `allocationBps` numbers (0..10000), timestamps as seconds (number), addresses as checksummed hex.

## Auth

| Method | Path | Body / Notes |
|---|---|---|
| POST | `/auth/challenge` | `{ networkKey, wallet }` -> `{ challenge }` EIP-712 object (domain: name/version/chainId/verifyingContract; message binds wallet, user, nonce, issuedAt, expiresAt). |
| POST | `/auth/verify` | `{ challenge, signature }` -> `{ token, expiresAt }`; verifies signature, consumes nonce. |
| POST | `/auth/session` | `{ token }` -> session details (validates + refreshes expiry). |
| POST | `/auth/logout` | revoke `{ token }`. |

## Wallet

| Method | Path | Notes |
|---|---|---|
| GET | `/wallet` | session wallet address + registered KeyHandle metadata + created-at. |
| GET | `/wallet/address` | receive address (QR/copy data for the frontend). |
| GET | `/wallet/balances` | live `eth_call` balances for supported assets (ETH + USDC). Never cached-as-authoritative. |
| GET | `/wallet/transactions` | indexed history (paged), tagged sent/received for supported assets. |
| POST | `/wallet/send` | `{ to, asset, amount }` -> prepared+simulated send (unsigned tx + simulated result). |

## Assets

| Method | Path | Notes |
|---|---|---|
| GET | `/assets` | supported assets per network: `{ symbol, address, decimals, native }` (ETH + USDC). Unsupported tokens are listed as unsupported, not claimed. |

## Vault

Materialized from the chain (factory + instance views) — never authoritative from DB.

| Method | Path | Notes |
|---|---|---|
| POST | `/vaults` | `{ networkKey, checkInInterval, maxMissedCheckIns, beneficiaries }` -> create via factory (unsigned tx to sign/broadcast). One vault per owner; idempotent (revert/preflight if exists). |
| GET | `/vaults/:owner` | vault instance address + summary (from factory discovery). |
| GET | `/vaults/:owner/status` | owner, state (ACTIVE/MISSED/ELIGIBLE/DISTRIBUTING/DISTRIBUTED/CLOSED), lastCheckIn, interval, maxMissed, reserve, balances. |
| GET | `/vaults/:owner/activity` | indexed vault events (deposits/withdrawals/checkins/beneficiary changes/distribution). |
| POST | `/vaults/:owner/close` | prepare close (only when balances + reserve are zero). |

## Beneficiaries (owner-only)

| Method | Path | Notes |
|---|---|---|
| GET | `/vaults/:owner/beneficiaries` | current list + total allocation (chain view). |
| PUT | `/vaults/:owner/beneficiaries` | replace list `{ accounts, allocationBps }` -> prepared unsigned tx; schema validation (sum == 10000, non-zero, unique, <= 50). |
| DELETE | `/vaults/:owner/beneficiaries` | replace with a single beneficiary @ 100% (or explicit list) -> prepared unsigned tx. |

## Inheritance

| Method | Path | Notes |
|---|---|---|
| GET | `/vaults/:owner/inheritance` | combined: eligibilityDeadline, missedCheckIns, state, nextExpectedCheckIn. |
| POST | `/vaults/:owner/inheritance/checkin` | prepared `checkIn` unsigned tx (owner). Resets timer. |
| GET | `/vaults/:owner/inheritance/eligibility` | live eligibility + deadline (chain truth). |
| GET | `/vaults/:owner/inheritance/distribution` | per-token processed flag, pending entitlements, retry times, distributed amounts. |

## Transactions

| Method | Path | Notes |
|---|---|---|
| POST | `/transactions/prepare` | `{ networkKey, to, data, value?, from? }` -> unsigned `PreparedTransaction` (nonce, gas estimate/limit computed here). |
| POST | `/transactions/simulate` | `{ PreparedTransaction, stateOverride? }` -> simulated result (success + returned value or revert reason). Not confirmation. |
| POST | `/transactions/submit` | `{ rawSignedTransaction }` -> broadcast; returns hash + initial status **pending** (never "confirmed"). |
| GET | `/transactions/:hash` | real status from receipt/confirmation depth; only `status=confirmed` after status===1 + depth. |

## Keeper / admin

| Method | Path | Notes |
|---|---|---|
| GET | `/automation/candidates` | eligible/unprocessed vault candidates (chain-derived). |
| POST | `/automation/run` | trigger one worker pass (trigger -> distribute -> retry -> claim), ingestion-locked; returns per-candidate results. |

## Error model

- `4xx`: validation/auth (e.g., `INVALID_ALLOCATION`, `VAULT_EXISTS`, `NOT_OWNER`, `EXPIRED_CHALLENGE`).
- `5xx`: RPC/DB failures with a structured `{ error }`; never exposes secrets.
- Prepared/write errors are surfaced before signing; simulation errors before broadcast.

## Notes / boundaries

- No endpoint marks a transaction confirmed; only the receipt path does.
- No place stores or returns a private key; `/wallet` returns only public metadata.
- Page/targeting: list endpoints are paginated (`?limit&cursor`).
- CORS/CSP and rate limits are Phase 6 operational concerns.