# Kinn — FRONTEND.md — Briefing for building the Web App

Audience: the frontend builder. **You do not need to change the backend or the
contracts — everything below is already implemented, tested, and live on Base
Sepolia.** Your job is UX on top of an existing, working system.

## 1. What Kinn is (30 seconds)

Kinn is a dead-man's-switch inheritance vault. A user (the **owner**) creates a
vault, names beneficiaries with percentage allocations, deposits assets (ETH +
USDC on the supported set), and periodically **checks in**. If they stop
checking in for the configured number of periods, the vault becomes **Eligible**
and anyone (a permissionless keeper) can trigger inheritance and distribute
every tracked asset to the beneficiaries exactly per the stored allocations.

## 2. Trust model — why the frontend looks the way it does

- The **contracts are the only authority**: ownership, allocations, eligibility
  timing, and all fund movement are enforced on-chain (`src/KinnVault.sol`).
- The **backend is non-custodial and untrusted**: it reads chain state, indexes
  events, prepares **unsigned** transactions, and runs the keeper. It cannot
  move funds or change vault terms. There is no admin key. Compromise of the
  backend cannot steal anything (`SECURITY.md` §1–2, verified in Phase 10).
- Therefore: the frontend must **never** expect (or request) the backend to
  sign, submit, or custody anything. Every write flow ends with the user's
  wallet signing a prepared transaction and the frontend/wallet broadcasting it.

## 3. Testing status (so you know what you can rely on)

The full stack is already proven end-to-end on **live Base Sepolia** — this was
executed in Phase 11 (`PHASE11_STATUS.md`) with the security review in Phase 10
(`PHASE10_STATUS.md`, `SECURITY.md` §5 matrix):

- 121/121 contract tests including invariant, fuzz, and adversarial suites
  (Phase 4) — double-distribution, early trigger, non-owner writes, reentrancy,
  malicious-token delivery, rounding, and duplicate actions all revert as
  designed.
- 98/98 backend tests.
- **A real on-chain E2E run**: token deploy → vault create → reserve top-up →
  ETH + token deposits → check-in → real-time wait → on-chain eligibility at
  exactly the computed deadline → keeper trigger → duplicate-trigger rejection →
  both assets distributed at the exact 70/30 allocation → zero pending
  entitlements → final state `Distributed`. Every step's tx hash is recorded in
  `PHASE11_STATUS.md`. The duplicate trigger reverted as expected; the keeper's
  gas was reimbursed from the vault's automation reserve.

Consequence for you: the flows below work. Build the UI against them; report
bugs rather than working around them in the frontend.

## 4. Architecture and where your app sits

```
[User wallet (first-party KeyManager)]   <-- signs; source of user identity
        |  (fetch unsigned tx / post signature flows)
[Your frontend]  --HTTPS-->  [Backend HTTP API /api/v1/<network>/...]
                                   |  read-only RPC + event indexer (DB cache)
                                   v
                     [VaultFactory + KinnVault instances on-chain]
                                   ^  permissionless keeper (backend automation)
```

- API mounts at `/api/v1/:networkKey/...` (`backend/src/web/KinnHttpApi.ts`).
  `networkKey` today: `base-sepolia`; mainnet will be `base`.
- `GET /api/v1/<network>/assets` returns the supported asset list

## 5. Authentication (wallet-first, EIP-712)

1. `POST /api/v1/<network>/auth/challenge` `{ wallet, networkKey }` → challenge
   message.
2. User signs the challenge with their wallet (personal/EIP-712 per the
   challenge payload).
3. `POST /api/v1/<network>/auth/verify` `{ nonce, signature }` →
   `{ token, expiresAt }`.
4. Send `Authorization: Bearer <token>` on all authenticated calls.
5. `POST .../auth/session` validates a token; `POST .../auth/logout` ends it.
The session binds the verified wallet as the owner; write endpoints derive the
owner server-side, so the frontend never passes an owner address (spoofing is
impossible by construction).

## 6. The universal write pattern (memorize this)

Every owner write is: **prepare → simulate (optional) → wallet signs → wallet
broadcasts → verify on-chain**.

1. `POST` the relevant endpoint → response `{ prepared: { chainId, to, data,
   value, from } }`.
2. Optionally `POST .../transactions/simulate` with the prepared tx (an
   `eth_call`) for early revert feedback. "Simulation is not confirmation."
3. Have the wallet sign `prepared` (`eth_sendTransaction` from the connected
   wallet is the simplest path; the backend deliberately does NOT broadcast).
4. After the tx confirms, re-read state (below). `POST .../transactions/submit`
   returns `202 unbroadcast` by design — the API never submits funds.
5. Note the API returns `value` as a **string** (wei) — use BigInt, not Number.

### Prepared-transaction endpoints (all under `/api/v1/<network>`)

| Action | Endpoint | Notes |
|---|---|---|
| Create vault | `POST /vaults` `{ interval, maxMisses, beneficiaries: [{account, allocationBps}] }` | one vault per owner; allocations must sum to 10000 |
| Check in | `POST /vaults/<owner>/inheritance/checkin` | resets the dead-man clock fully |
| Update beneficiaries | `PUT /vaults/<owner>/beneficiaries` | replaces the whole list |
| Remove a beneficiary | `DELETE /vaults/<owner>/beneficiaries` | keeps the first only |
| Update interval/misses | prepared via `update_settings` action | |
| Approve token | prepared via `approve_token` action | required before ERC-20 deposit |
| Deposit ERC-20 | prepared via `deposit` action | uses balance delta; fee-on-transfer rejected |
| Deposit ETH | prepared via `deposit` action (ETH sentinel) or plain value tx | |
| Withdraw | prepared via `withdraw` action | owner-only, before trigger |
| Top up reserve | prepared via `top_up_automation_reserve` action | funds keeper reimbursements |
| Close vault | `POST /vaults/<owner>/close` | only when empty and untriggered |

(If a specific action body isn't exposed as an endpoint, use
`POST /transactions/prepare` with `to` + ABI-encoded `data` — the backend
prepares and the pattern is identical.)

## 7. Read endpoints (build the dashboard on these)

| Data | Endpoint |
|---|---|
| Vault state (owner, address, lastCheckIn, interval, maxMissed, active, triggered, reserve) | `GET /vaults/<owner>/status` |
| Activity feed (indexed events, latest 50) | `GET /vaults/<owner>/activity` |
| Beneficiaries + total allocation | `GET /vaults/<owner>/beneficiaries` |
| Missed check-ins / eligibility | `GET /vaults/<owner>/inheritance` |
| Distribution view (per-asset balances) | `GET /vaults/<owner>/inheritance/distribution` |
| Wallet balances (all supported assets) | `GET /wallet/balances` |
| Wallet tx history | `GET /wallet/transactions` |
| Supported assets | `GET /assets` |

All numeric chain values are returned as **strings** (BigInt-safe). The vault
status includes `lastCheckIn`, `checkInInterval`, `maxMissedCheckIns` — the
deadline the UI should display is `lastCheckIn + interval × maxMissed`
(on-chain: `eligibilityDeadline()`).

## 8. The state machine your UI must reflect

`Active → Missed → Eligible → (triggered) Distributing → Distributed`, plus
`Closed`. On-chain-derived; `GET .../status` + `.../inheritance` give you the
inputs. UI rules that mirror the contract:

- **Active**: deposits/withdrawals/check-in/settings all allowed.
- **Missed**: owner can still check in or withdraw; trigger not yet possible.
- **Eligible**: anyone (incl. the keeper) can trigger — show a countdown /
  "inheritance can now be triggered" state; owner writes now revert.
- **Distributing**: keeper is processing assets one per transaction; failed
  deliveries stay pending and are retried (gas-capped, isolated) — do not
  treat pending as lost.
- **Distributed**: terminal for the vault's assets.
- **Closed**: empty + untriggered closure; the owner may create a new vault.
- Irreversibility to convey clearly: once triggered, inheritance is permanent;
  a check-in resets the clock fully (no partial credit).

## 9. Who does what (frontend expectations)

- **User wallet**: all owner actions (create, deposit, withdraw, check-in,
  settings, close) and approves ERC-20 spending.
- **Backend keeper** (automatic, not your concern): trigger, per-asset
  distribution, retries of failed entitlements, reserve claim — all
  permissionless; the contract validates everything. The UI simply shows the
  resulting state via `/activity` and `/status`.
- **The backend never needs signing UI** — if you find yourself building a
  flow where the server signs, stop; that flow is wrong by design.

## 10. Error handling

Errors are JSON: `{ error: { code, message } }` with an HTTP status. Notable
codes: `401 UNAUTHORIZED` (missing/expired session), `400 INVALID_INPUT`,
`400 INVALID_ALLOCATION` (beneficiary list malformed or ≠ 10000 bps),
`404 NOT_FOUND`. Simulated reverts come back as `{ success: false, revert }`
from `/transactions/simulate`. Surface revert reasons verbatim — they map to
on-chain errors (`NotOwner`, `InheritanceNotEligible`, `VaultInactive`,
`InvalidAllocation`, `TokenTransferFailed`, `InheritanceAlreadyTriggered`,
… — see the error block in `src/KinnVault.sol`).

## 11. Practical notes

- Networks: today `base-sepolia` (factory
  `0x672778401F0F550284347Bf32aB883B4a2A72933`, see `PHASE11_STATUS.md`); the
  Phase 7 factory `0x9C90d4eC…` is **stale — do not use it**. Mainnet
  addresses land in `REALDEPLOYMENT.md` when deployed.
- A reference implementation of the auth + signing loop exists in
  `backend/wallet-client/client.ts` (smoke-test quality, but shows the exact
  flow end-to-end).
- Contract ABIs are in `backend/src/contracts/` (`factoryAbi.ts`,
  `vaultAbi.ts`) if you prefer reading contracts directly via wagmi/viem —
  both are legitimate; the API additionally gives you indexed activity.
- Don't cache chain-derived state aggressively; balances/deadlines change with
  every block and every keeper action.


