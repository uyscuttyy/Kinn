# Kinn — Architecture (Phase 2)

Status: COMPLETE · 2026-08-28
Supersedes/augments: `PHASE0_DESIGN.md` (kept for historical decisions). This document defines the target architecture for the Web App / wallet-first product: self-custodial **Kinn Wallet** (everyday crypto) + contract-controlled **Kinn Vault** (programmable inheritance). Base is the initial network; the design is chain-agnostic.

## 1. Product distinction (preserved)

```
                    KINN
                      │
        ┌─────────────┴─────────────┐
        │                           │
  KINN WALLET                  KINN VAULT
  "Money I use."              "Money I protect for inheritance."
  Send/receive                 Beneficiaries
  Hold assets                  Check-ins
  Transactions                 Inheritance rules + distribution
```

- The **Vault is contract-controlled**. Protected assets are held by the Vault contract and are never controlled by the backend or the Kinn team.
- The backend can read, prepare, simulate, index, notify, and run a permissionless keeper. It **never** holds user private keys, never signs owner transactions, and has **no administrative backdoor**.
- The smart contract is the **sole authority** for: ownership, beneficiaries, allocations, check-in state, eligibility, and distribution.

## 2. High-level architecture

```
 Web App (Kinn Wallet)
    |  encrypts/signs with a first-party KeyManager (never the backend)
    v
 Backend API (REST)
    |  build + simulate + (index / notify / keeper)
    v
 Blockchain service (read RPC + prepare calldata + eth_call simulation)
    v
 Base (Base Sepolia for dev/test, Base for prod)
    |  VaultFactory -> KinnVault instances (CREATE2 / clones)
    v
 Indexer (durable cursor, confirmation depth) -> Database (indexed/cache data)
    v
 Automation/Keeper (discover eligible -> verify -> submit -> confirm)
```

Trust rule: **The indexer/database is derived data and can always be rebuilt from the chain. It is never authoritative for ownership, balances, beneficiaries, or inheritance state.** All such values are read live from the chain via `eth_call`.

## 3. Key-management / wallet architecture (first-party wallet)

Goal: Kinn is the wallet. No dependency on MetaMask/Phantom/Coinbase. Signing sits behind a clean interface so it can evolve.

**`KeyManager` interface** (TypeScript) — the boundary. Exposes only:
- `generate(): KeyHandle`
- `getAddress(handle): string`
- `signMessage(handle, message): string`
- `signTransaction(handle, tx): Signature`
- `destroy(handle)`, `has(handle): boolean`, `list(): KeyHandle[]`

Never in scope: persisting raw keys, exporting private keys, reverse-engineering a handle.

**Pluggable backends** (only the first is built now; rest are future):
- `LocalEncryptedKeyManager` (initial): strong-random keygen; encrypted at rest (AES-GCM + PBKDF2/scrypt-style derivation via WebCrypto); never sent to the backend; never logged/printed.
- Future: `PasskeyKeyManager` (WebAuthn), `ExternalSignerKeyManager` (hardware), `SmartAccountManager` (ERC-4337), session keys.

## 4. Vault Factory + instance architecture

- One `VaultFactory` per chain (deployed once). It is the sole creator/initializer of Vault instances.
- Each owner gets exactly one `KinnVault` instance (one-vault-per-user), created via **CREATE2** with `salt = keccak256(owner, factoryNonce)` so the vault address is deterministic/deduplicable.
- `createVault`/`newVault` is **idempotent and permissioned**: only an EOA owner (or future account) may create for themselves; the factory reverts if the owner already has a vault; discovery returns the existing instance instead of creating a duplicate.
- Registry: factory maps `owner -> vaultAddress`, emits `VaultCreated(owner, vault, salt)`, exposes `vaultOf(owner)`, `vaultCount()`, and iterative discovery.
- Instance model: each vault stores its own `owner`, beneficiaries, tokens, reserve, and inheritance state, so a compromise of one instance cannot affect others. The inheritance execution logic, allocation math, retry model, isolated transfer primitive, and automation reserve from the audited `KinnVault.sol` are **preserved inside the instance**.

Rationale vs. the current single-contract `mapping(owner => Vault)` model: the current implementation works, but the product requires a factory, discovery, and idempotent one-vault-per-user. Moving state into instances isolates storage and simplifies ownership guards.

## 5. Inheritance state machine (explicit, on-chain)

Enum stored in each vault instance:
`ACTIVE -> MISSED -> ELIGIBLE -> DISTRIBUTING -> DISTRIBUTED` (plus `CLOSED`).

| State | Meaning | Entered by | Exits |
|---|---|---|---|
| `ACTIVE` | Owner can configure/deposit/withdraw/check-in. | creation | -> `MISSED` (a deadline passes), -> `CLOSED` (owner closes an empty vault) |
| `MISSED` | >=1 deadline missed, not yet eligible. Owner may still check in. | derived whenever a deadline passes without check-in | -> `ACTIVE` (check-in resets timer), -> `ELIGIBLE` |
| `ELIGIBLE` | Inheritance conditions satisfied. `triggerInheritance` is permitted (permissionless). | threshold reached | -> `ACTIVE` (owner checks in before trigger; resets), -> `DISTRIBUTING` (trigger) |
| `DISTRIBUTING` | `inheritanceTriggered=true`, vault frozen to owner; assets distribute per token; pending retries possible. | trigger | -> `DISTRIBUTED` |
| `DISTRIBUTED` | All tokens processed, no pending entitlements, reserve reclaimed/claimed. Irreversible. | completion | terminal |
| `CLOSED` | Owner closed an empty active vault. | closeVault | terminal (owner may create a new vault) |

**Eligibility formula (authoritative, documented):**
- Each vault defines `checkInInterval = P` and `maxMissedCheckIns = N` (N >= 1).
- `lastCheckIn` starts at creation; every `checkIn()` sets `lastCheckIn = block.timestamp` (full reset — no partial credit).
- A period is "missed" once `block.timestamp > lastCheckIn + P`.
- Missed count (derived): `missed = floor((block.timestamp - lastCheckIn) / P)`.
- A vault is **eligible** exactly when `block.timestamp >= lastCheckIn + P * N`.
  - Interpretation pinned: with `N = 2`, `P = 30d` -> eligible at day 60 (2 complete missed periods). It is NOT eligible after the first missed period.
- **Cancellation**: eligibility is cancellable until trigger — a check-in before `triggerInheritance` resets `lastCheckIn` and returns the vault to `ACTIVE`/`MISSED`. After `triggerInheritance`, the transition to `DISTRIBUTING` is **permanent and irreversible**; the owner can no longer modify anything.
- The contract computes eligibility from chain state; the backend/frontend/keeper merely *report* it and can only *attempt* a trigger that the contract independently validates.

**Enforced transitions (invalid ones revert on-chain):**
- distribution while `ACTIVE`/`MISSED`/`ELIGIBLE` -> revert (not triggered).
- duplicate trigger after `DISTRIBUTING` -> revert.
- early trigger (before eligible) -> revert for any caller.
- unauthorized: non-owner configure/deposit/withdraw/check-in/close -> revert.
- beneficiary modification after trigger -> revert.
- invalid check-in transitions (nonexistent/inactive vault, after trigger) -> revert.
## 6. Distribution design

- Trigger (`triggerInheritance`, permissionless): validates eligibility on-chain, moves `ELIGIBLE -> DISTRIBUTING`, marks `inheritanceTriggered`, freezes owner writes. Emits `InheritanceTriggered`.
- Per-token distribution (`distributeInheritanceToken`, permissionless): snapshots the vault token balance once, zeros accounting, splits per allocation BPs with remainder to the last beneficiary. Emits `InheritanceDistributed` per entitlement.
- Retry (`retryInheritanceDistribution`, permissionless): re-attempts stored pending entitlements after the retry interval on failed transfers.
- **Double distribution is impossible**: each token snapshotted once (`inheritanceTokenProcessed`); successful entitlements cleared; only stored unpaid amounts can be retried; isolated transfer plus exact-balance invariant prevents false-success double pays.
- **Assets**: ETH (native) and USDC (selected ERC-20) in the initial set. ETH uses `address(this).balance` minus the automation reserve and must never be conflated with the reserve. Rounding: remainder -> last beneficiary; deterministic ordering.
- Events: `VaultCreated`, `AssetDeposited`, `AssetWithdrawn`, `BeneficiariesUpdated`, `CheckedIn`, `InheritanceTriggered`, `InheritanceTokenProcessed`, `InheritanceDistributed`, `InheritanceDistributionFailed`, `RetryScheduled`, `AutomationFeePaid`, `VaultClosed`.

## 7. Ownership / authority

- Ownership is `msg.sender`-scoped per instance (the creating wallet). The factory cannot configure/withdraw/trigger for an owner; it only deploys and registers.
- Owner-only on-chain functions: `updateSettings`, `updateBeneficiaries`, `deposit`, `withdraw`, `checkIn`, `closeVault`, reserve top-up/withdraw. All gate on `msg.sender == owner` and vault state.
- Permissionless: `triggerInheritance`, `distributeInheritanceToken`, `retryInheritanceDistribution`, reserve claim (completeness-gated) — these only advance inheritance and are independently eligibility-validated on-chain.
- **Backend compromise assumption**: a fully compromised backend can read, prepare, simulate, index, and call permissionless maintenance — but cannot move owner funds, change beneficiaries/allocations, withdraw assets, or falsely trigger inheritance, because the contract independently verifies every such action. This is the core security guarantee, verified by adversarial tests (Phases 4, 10).
## 8. Transaction / simulation flow

```
Web App -> Backend API
   build (prepare unsigned calldata, estimate/limit gas, nonce)
   simulate (eth_call with connected-account from / stateOverride)
   validate (simulated result == expected; no revert)
   -> Kinn KeyManager signs  (client-side, EIP-1559 tx or typed-data)
   broadcast (via Web App/provider)
   wait for confirmation (receipt; status===1; confirmation depth)
   indexer records transaction + events
   return real status/hash
```
- **Simulation is not confirmation. Broadcast is not settlement.** Only a confirmed receipt (status === 1, sufficient depth) marks a transaction confirmed. Nothing is ever marked successful before on-chain confirmation.
- The backend returns unsigned transaction data; the wallet is the only signer. No API request can silently move funds.

## 9. Database (durable) and source-of-truth boundary

**Blockchain is source of truth (read live via `eth_call`, never authoritative in DB):**
ownership, vault balances, beneficiaries, allocations, check-in state, inheritance status/eligibility, distribution status.

**Backend/indexed data (DB — derived, rebuildable):**
- `users` (signer identity / auth)
- `wallets` (public address + handle metadata; **no private keys ever**)
- `vault_registry` (mirror of factory: owner -> vault address/chain)
- `transactions` (hash, sender, to, chain, data-hash, status, confirmations, block — cache only)
- `vault_events` (parsed events index, deduped by txHash+logIndex)
- `notifications`, `jobs` (keeper/reminder state), `indexing_cursor`, `supported_assets`

Rules: a per-table `source` flag distinguishes "chain mirror" from "app data". DB never overrides chain state; any cached balance/status is refreshed from the chain before use in authoritative decisions.

## 10. Indexing design

- Poll block range from a **durable cursor** in the DB (starts from the factory deploy block).
- Apply **confirmation depth** (e.g., only index state-mutating events at/after the chain's `safe`/finalized head; balance reads use a consistent `latest`/`safe`).
- **Restart-safe**: cursor stored after each batch; re-scan from cursor on restart; events deduped by `(txHash, logIndex)` regardless of cursor drift.
- Handle RPC failures by retrying with backoff and never advancing the cursor on partial failure.
- Support **reconstruction**: replay all `VaultFactory`/`KinnVault` events from the deploy block to rebuild vault history/transaction history.

## 11. Backend API (Web App)

Designed around the architecture (not Telegram endpoint names). Base URL per deployment/chain. Responses are JSON; bigints serialized as decimal strings. Auth via session token issued after an EIP-712 challenge binding user, wallet, chain, and nonce.

- Auth: `POST /auth/challenge`, `POST /auth/verify`, `POST /auth/session`, `POST /auth/logout`
- Wallet: `GET /wallet`, `GET /wallet/balances`, `GET /wallet/transactions`, `POST /wallet/send` (prepare+simulate), `GET /wallet/address` (receive data)
- Assets: `GET /assets` (supported set + metadata)
- Vault: `POST /vaults` (create), `GET /vaults/:owner`, `GET /vaults/:owner/status`, `GET /vaults/:owner/activity`, `POST /vaults/:owner/close`
- Beneficiaries (owner-only): `GET /vaults/:owner/beneficiaries`, `PUT /vaults/:owner/beneficiaries`, `DELETE /vaults/:owner/beneficiaries`
- Inheritance: `GET /vaults/:owner/inheritance`, `POST /vaults/:owner/inheritance/checkin`, `GET /vaults/:owner/inheritance/eligibility`, `GET /vaults/:owner/inheritance/distribution`
- Transactions: `POST /transactions/prepare`, `POST /transactions/simulate`, `POST /transactions/submit` (signed tx), `GET /transactions/:hash`
- Keeper/admin (authenticated, injection-based): `GET /automation/candidates`, `POST /automation/run`

Every write-designing endpoint returns an **unsigned** `PreparedTransaction` for the wallet to sign/broadcast; it never submits funds itself. See `API.md`.
## 12. Base integration (verified, official)

Initial chain: **Base Sepolia** (dev/test), **Base** (prod). Values verified this phase from `ethereum-lists/chains` and live `eth_call`:

| | Base (mainnet) | Base Sepolia (testnet) |
|---|---|---|
| chainId / networkId | 8453 | 84532 |
| native currency | ETH (18) | Sepolia ETH (18) |
| public RPC | `https://mainnet.base.org` | `https://sepolia.base.org` |
| explorer | `https://basescan.org` | `https://sepolia.basescan.org` |
| native USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (dec 6) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (dec 6) |

Chain configuration lives in a single `networks/` module (env-driven: `KINN_NETWORKS`, per-network config). Business logic imports config; adding a network = adding a config entry (the existing `DeploymentRegistry`/`loadNetworkConfigs` pattern is retained and extended). Values are sourced from the tables above; do not guess.

**Asset support (initial, tested):**
- Native **ETH** (mainnet + Sepolia)
- **USDC** (native, the verified 6-decimal contracts above)
- Other ERC-20s are **not claimed** as supported until tested; unsupported tokens are blocked at deposit or fail safe.

## 13. Accelerated dev/test time vs production

- The **contract never has a time-override/backdoor**. Eligibility uses only `block.timestamp`. Thus no production path allows arbitrary time manipulation (required by section 32).
- Dev/test acceleration comes from **legitimate interval parameters** + test harnesses:
  - Dev/test deployments use short `checkInInterval` (e.g., 60 s) — a normal validated parameter, not a bypass.
  - Solidity unit/integration tests use Foundry `vm.warp` to advance time deterministically.
  - Optional: mainnet-fork tests accelerate naturally.
- Production intends real multi-day/week periods; production config is separate from dev/test config and enforces the same parameter bounds.

## 14. Automation / keeper

- Job (existing `AutomationWorker` retained): for each candidate vault -> read chain state -> if eligible & not triggered, prepare `triggerInheritance`; distribute each unprocessed token; retry pending entitlements; claim reserve when complete.
- **Contract remains the final authority**: the keeper only *attempts* calls the contract independently validates. It cannot distribute twice (on-chain snapshot/clear + indexed idempotency) and cannot choose recipients or amounts.
- Submission runs behind an injected `RelayerSubmitter` against a **managed signer** (Phase 6 fixes the current raw private-key ingestion in `runOnce.ts`).
- Errors retry safely; results recorded to the DB; never double-submit is a tracked invariant (Phase 9).

## 15. Threat model (summary) — see `SECURITY.md`

Primary guarantees: backend compromise cannot move funds or alter inheritance; trigger/distribution are permissionless but eligibility/amounts are on-chain; distribution cannot double-execute; reentrancy guarded; malicious ERC-20 handled via isolated gas-capped transfers with balance invariants; rounding deterministic; time determinism bounded.

## 16. Migration/reuse (from audit)

- KEEP inherited: on-chain eligibility, allocation validation, per-token distribution + rounding remainder, retry model, isolated transfer primitive, automation reserve, non-custodial read/prepare services, deployment registry, `AutomationWorker` seams, all Telegram code (frozen).
- REFACTOR: split single contract into Factory + instance; explicit state machine; wallet-first identity; simulation; durable cursor/DB; managed signer.
- REPLACE: MetaMask-delegating wallet page -> first-party KeyManager wallet; in-memory/JSONL repos -> durable DB.

## 17. Phased implementation map

Phase 3 Smart Contracts (Factory + instance + ETH/USDC + state machine) -> Phase 4 Contract testing (invariant/fuzz/adversarial) -> Phase 5 Wallet infra + KeyManager (**complete** — see [PHASE5_STATUS.md](PHASE5_STATUS.md)) -> Phase 6 Backend/DB/API (**complete** — see [PHASE6_STATUS.md](PHASE6_STATUS.md)) -> Phase 7 Base deployment -> Phase 8 Indexing -> Phase 9 Automation hardening -> Phase 10 Security -> Phase 11 E2E on Base Sepolia. Each phase has its own detailed plan in its phase gate.
Constraints in this phase: the backend has no private-key path; it only builds/simulates unsigned transactions returned for the wallet to sign and broadcast. KeyManager backends are isolated so future smart-account/hardware paths satisfy the same interface.