# Kinn — Phase 1 Repository Audit

Status: COMPLETE · 2026-08-28

Scope: Existing Kinn implementation (EVM contract, non-custodial backend, Telegram gateway, hosted wallet page). No functionality was modified during this audit. The goal is to identify what works, what is incomplete, what is reusable, and what must be refactored for the "Kinn Wallet + Kinn Vault" product, with Base as the initial network.

## 0. Test / build baseline (verified this phase)

- `forge test` (Foundry, solc 0.8.24): **68 contract tests pass, 0 fail** across 6 suites.
- `npm run test:backend` (node:tsx test runner): **44 backend tests pass, 0 fail**.
- Coverage already exercised on-chain: vault creation, allocation validation, duplicate rejection, check-ins, missed-check-in thresholds, early-trigger rejection, double-execution rejection, per-token distribution, rounding remainder, transfer-failure retries, isolated transfer entry point, token-cannot-be-processed-twice, owner-ops-rejected-after-trigger, automation reserve.
- `npm run build:backend` was not re-run in this audit (no code changes); existing `dist/` present.

Version context: platform is Node >= 22.15, ethers v6, foundry. Current recorded testnet evidence is **X Layer (chain 1952)**, but the product target for this phase is **Base Sepolia**. Base configuration values must be sourced from official Base docs before deployment (Phase 7) and must not be guessed.

## 1. What the repository contains

| Component | Files | Role |
|---|---|---|
| Vault contract | `src/KinnVault.sol` | Single contract, `mapping(owner => Vault)`, one vault per owner, inheritance dead-man-switch. |
| Test RWA token | `src/TestRwaToken.sol` | ERC-20 fixture. |
| Contract tests | `test/*.sol` + `MockERC20.sol` | 6 suites, 68 tests. |
| Deploy scripts | `script/*.sol` | Foundry deploy / retry scenarios. |
| Backend | `backend/src/**` | Non-custodial service layer. |
| Backend tests | `backend/test/*.ts` | 10 files, 44 tests. |
| Wallet client | `backend/wallet-client/client.ts` | Hosted page bundle; delegates signing to injected MetaMask or WalletConnect. |
| Wallet server | `backend/src/wallet/server.ts` | HTTP server serving the hosted auth page + secure tx callback. |
| Automation | `backend/src/automation/**` | Relayer-driven trigger/distribute/retry/claim. |
## 2. What works (verified)

- **Contract authority model**: the `KinnVault` contract enforces ownership (`msg.sender` checks), allocation math, timing, inheritance eligibility, duplication prevention, and post-trigger immutability. The backend never authorizes writes.
- **Dead-man-switch core**: `createVault → checkIn → (miss) → triggerInheritance → distributeInheritanceToken → retry` is implemented and tested.
- **Inheritance eligibility** is computed **on-chain** (`_inheritanceEligible`), satisfying "backend must not be the final authority."
- **Round-safe distribution**: last beneficiary receives the exact remainder; entitlements are stored per token/beneficiary for retry.
- **Isolated token-transfer entry point** (`attemptTokenTransfer`, `OnlySelf`, 200k gas cap, exact-balance invariant) is a strong, reusable primitive.
- **Native automation reserve** reimburses relayer gas and cannot block inheritance when empty; unused reserve is claimable only when complete.
- **Non-custodial backend pattern**: `RpcClient` (read-only), `KinnContractService` (read + prepare unsigned calldata), `KinnApi`/`AuthenticatedKinnApi` (prepare-only), `WalletAuthService` (EIP-712 challenge), `KinnEventMonitor` (block-range polling), `AutomationWorker` (idempotent, injection-based), `EthersRelayerSubmitter`.
- **Chain-agnostic deployment registry** (`DeploymentRegistry`, `loadNetworkConfigs`) already decouples chain config from business logic — aligned with the multi-network goal.
- **Telegram** (`backend/src/telegram/**`, reminders, AI) is a complete, tested subsystem and must be **preserved as frozen**.

## 3. Security findings (carried into hardening)

High/structural:

1. **Vaults are not instances.** One global `KinnVault` holds `mapping(owner => Vault)`. There is **no Vault Factory**, no per-user contract, no discovery-by-instance, no CREATE2. Product section 11 requires a factory + one-vault-per-user with idempotent creation and discovery. → REPLACE with Factory + instance model.
2. **No native ETH in the vault.** `deposit`/`withdraw` are ERC-20 only. Product requires distributed assets to safely support **native ETH** plus selected ERC-20. `topUpAutomationReserve` is the only payable path and is not a protected asset. → ADD native ETH deposit/distribution path; account ETH separately from the automation reserve.
3. **Broad ERC-20 surface is claimed implicitly.** Any ERC-20 token can be deposited. Fee-on-transfer, rebasing, reflection, blacklist/freeze tokens are documented as unsupported but not blocked or detected at deposit. Product section 19 wants a small, well-tested set (ETH + USDC) before claiming broader support. → Restrict or detect, at minimum document and test exactly.

Medium:

4. **Eligibility formula is under-specified / ambiguous.** `_inheritanceEligible` = `lastCheckIn + interval * maxMissedCheckIns <= block.timestamp`, and `missedCheckIns` = `elapsed / interval`. With `maxMissedCheckIns = N`, a vault becomes eligible at the **Nth** missed deadline (example: interval 30d, maxMissed 2 → eligible at day 60, having missed 2). There is no ACTIVE→MISSED→ELIGIBLE→DISTRIBUTED state machine, and no explicit "deadline / missed / grace / whether check-in resets" spec (today check-in resets the full timer). Product sections 14–16 require an explicit, deterministic state machine and documented formula. → REFACTOR and fully document + test every transition.
5. **Time is wall-clock with a 9-week cap**, and tests accelerate via `vm.warp` (contract-side). There is no clearly separated development/test time configuration at the deployment level. Product section 32 requires a separated dev config where time can be accelerated (e.g. 1 min = 1 period), clearly distinct from production and with no production time-bypass. → Add separated deployment config; keep `vm.warp` patterns in tests.
6. **Backend loads a raw relayer private key from env** (`runOnce.ts`: `new Wallet(privateKey, provider)` reading `KINN_RELAYER_PRIVATE_KEY`). The README claims "Kinn does not load or persist a raw relayer private key," which is inaccurate. The relayer key is low-privilege (permissionless maintenance only) but the storage/management mechanism contradicts the stated security posture. → Move relayer signing behind a managed signer/KMS-style interface; fix the documentation; never persist.
7. **No transaction simulation.** `KinnContractService.prepare*` builds unsigned calldata; nothing performs `eth_call` simulation before signing. Product section 26 requires build → simulate → validate → sign → broadcast, and "simulation is not confirmation." → ADD simulation service.
8. **Sessions are bound to `telegramUserId`.** `WalletAuthService` binds challenges/sessions to Telegram identity + deploymentKey. The Web App needs a wallet-first identity (not Telegram-dependent). The EIP-712 challenge primitive is reusable, but the identity model must be generalized. → REFACTOR identity model while preserving the Telegram path.

Lower / residual (documented in SECURITY_REVIEW.md / FINAL_REVIEW.md):

9. Malicious-token gas/state handling is addressed (isolated call, gas cap, balance invariant) — keep.
10. Reentrancy is guarded by a `nonReentrant` modifier on token/payable paths — keep; enumerate every external call in Phase 10.
11. `closeVault` requires empty balances + empty reserve — safe.
12. `claimCompletedAutomationReserve` is permissionless by design (relayer incentive) and gated by completeness, not double-payable — verify invariants again in Phase 4/10.
13. No CI configuration, no Slither (not installed), no automated dependency audit in-repo. Product sections 33/37 require these. → ADD CI + static analysis + `npm audit` + Foundry invariant/fuzz.
## 4. Architectural gaps vs. product definition

| Product requirement | Current state | Disposition |
|---|---|---|
| Kinn is the wallet (no MetaMask dependency) | Hosted page delegates to injected MetaMask/WalletConnect; no first-party Kinn wallet/key management | REPLACE with first-party wallet infra behind a key-management interface (Phase 5). |
| Base network | Evidence/ENV point at X Layer testnet; backend README mentions Base Sepolia as default | Config for Base Sepolia (Phase 7), sourced from official docs. |
| Vault Factory | None | REPLACE (Phase 3). |
| Explicit inheritance state machine | Implicit booleans (`active`, `inheritanceTriggered`) + threshold | REFACTOR (Phase 3). |
| Native ETH distribution | Not supported | ADD (Phase 3). |
| Selected asset set (ETH + USDC) | Generic ERC-20, no USDC-specific proof | ADD well-tested set (Phase 3/7). |
| Database (users/wallets/vaults/tx/events) | In-memory maps + JSONL files | REPLACE with durable DB (Phase 6). |
| Indexing with durable cursor + reconstruction | `KinnEventMonitor` + in-memory/file cursor | REFACTOR to durable + confirmation depth + restart/recovery (Phase 8). |
| Transaction history API | None beyond prepared calldata | BUILD (Phase 6). |
| Simulation | None | ADD (Phase 5/6). |
| Notifications | Telegram reminders (frozen implementation) | Keep backend pattern; contract remains authoritative (Phase 6/9). |
| Automation/keeper | `AutomationWorker` exists (relayer) | KEEP + harden discovery/retry (Phase 9). |
| Accelerated test time | `vm.warp` only | ADD separated dev config (Phase 3/7). |
| Docs (ARCHITECTURE/CONTRACTS/SECURITY/API/TESTING) | README + phase docs exist; new required set missing | CREATE (Phase 2 and throughout). |
| Frontend infrastructure APIs | Prepare-only Telegram-style API | BUILD clean REST API for Web App (Phase 6). |

## 5. Component disposition (KEEP / REFACTOR / REPLACE / REMOVE)

**KEEP (reuse as-is)**
- Inheritance core logic and invariants: on-chain eligibility, allocation validation, per-token distribution, rounding remainder, duplicate-payment prevention, post-trigger immutability.
- Isolated token-transfer primitive (`attemptTokenTransfer` + gas cap + balance invariant).
- Non-custodial service patterns: `RpcClient`, `KinnContractService` read/prepare model, `DeploymentRegistry`, `loadNetworkConfigs`.
- `EthersRelayerSubmitter` interface shape (inject signer) — but fix key ingestion.
- `AutomationWorker` orchestration state machine (trigger → distribute → retry → claim) with injection seams.
- `KinnEventMonitor` event-parsing logic (extend for durable cursor + reconstruction).
- **All Telegram code** (`backend/src/telegram/**`, reminders, AI) as frozen previous work.

**REFACTOR**
- `KinnVault.sol` → split into **VaultFactory + KinnVault instance**; extract shared enums/state (ACTIVE/MISSED/ELIGIBLE/DISTRIBUTED) and documented eligibility formula.
- `WalletAuthService` identity model → generalized `WalletIdentity` (wallet-first), keep Telegram session path for the frozen Telegram flow.
- `KinnContractService` / `KinnApi` → add wallet-side primitives (transfer send/receive, history, balances, simulation) reusing read/prepare patterns.
- Event monitoring → durable cursor, confirmation-depth awareness, restart/recovery, reconstruction.

**REPLACE**
- Hosted "delegate to MetaMask" wallet page → first-party **Kinn wallet** with secure key-management abstraction and signing behind a clean interface.
- In-memory/JSONL repositories (`InMemory*Repository`, `FileReminderRepository`, `FileAutomationRecordRepository`, in-memory cursor) → durable database layer (classified as indexed/cache data; blockchain remains source of truth).
- `runOnce.ts` raw `new Wallet(privateKey, …)` → injected managed signer.

**REMOVE / DO NOT BUILD**
- Do **not** remove Telegram, inheritance logic, or distribution logic.
- Do **not** build frontend visual design in this phase.
- Do not widen asset support until the minimal set (ETH + USDC) is proven.

## 6. Risks / issues requiring explicit documentation

- Eligibility interpretation of `maxMissedCheckIns` must be pinned and documented (Nth missed deadline, check-in resets the full interval, eligibility cannot be cancelled once triggered, trigger is permanent and irreversible).
- Tokens with fee-on-transfer/rebasing/reflection/freeze divergence between `_tokenBalances` accounting and actual held balance can cause withdrawal/inheritance mismatch; must be blocked or precisely bounded for the support set.
- Automation reserve is native ETH; must never be conflated with protected native-ETH assets when ETH inheritance is added.
- The relayer key ingestion must move behind a managed signer and the docs corrected.
- Base Sepolia chain ID / RPC / explorer / USDC contract / gas must be taken from official Base documentation; do not guess.

## 7. Plan for Phase 2 (Architecture)

1. Define the Vault Factory + instance architecture, CREATE2 instance derivation, factory registry, discovery, one-vault-per-user and idempotent creation.
2. Define the explicit inheritance state machine (states + transition guards + eligibility formula) and confirm it is enforced on-chain.
3. Define the first-party Kinn wallet architecture and the key-management/signing abstraction (interface first; concrete provider pluggable).
4. Define the durable database schema and the boundary between blockchain source-of-truth data and backend-indexed data.
5. Define the indexing design (durable cursor, confirmation depth, restart/recovery, history reconstruction).
6. Define the backend API surface for the Web App (wallet, vault, beneficiaries, inheritance, transactions, simulation, status).
7. Define Base integration config (official values), asset set (ETH + USDC), fees, and separated accelerated-test configurations.
8. Define the automation/keeper job design (discovery, verify, submit, confirm, retry; never double-distribute).
9. Define the security review + adversarial testing matrix and doc set (ARCHITECTURE.md, CONTRACTS.md, SECURITY.md, API.md, TESTING.md).
| Docs | `README.md`, `PHASE0_DESIGN.md`, `PROJECT_HANDOFF.md`, `SECURITY_REVIEW.md`, `FINAL_REVIEW.md`, `TESTNET_RUNBOOK.md`, `PHASE12_XLAYER_EVIDENCE.md`, `backend/README.md` | Handoff/evidence. |